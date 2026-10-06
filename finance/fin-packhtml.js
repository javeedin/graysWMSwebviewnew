/* Finance Lens — board packs as ONE interactive HTML file (and the e-mail that goes with it).
   FL.packs.build(pack) computes every section of a pack design (fin-packdesign.js) from the loaded data and returns
   { html, file, model }: html = a self-contained page (no CDN, works offline when opened from an e-mail) with a left
   menu — Summary, Trial balance, Income statement, Balance sheet, Cash flow, KPIs, charts, your own text — that
   shows one section at a time; statements open their lines into accounts, the trial balance opens by type, every
   table has a search box and a CSV download, Print prints the section on screen or the whole pack, a light / dark
   switch and a phone layout. model = the numbers the e-mail body needs (KPI tiles, key lines, highlights, chart).
   FL.packs.emailHtml(pack, model, opts) = an Outlook-safe message (tables + inline styles only, 640 px). */
(function () {
    var P = FL.packs = FL.packs || {};

    P.THEMES = {
        navy: { name: 'Navy', a: '#0b2545', b: '#1d4ed8', c: '#0d9488' },
        teal: { name: 'Teal', a: '#0f3d3e', b: '#0d9488', c: '#f59e0b' },
        plum: { name: 'Plum', a: '#3b0764', b: '#7c3aed', c: '#db2777' },
        graphite: { name: 'Graphite', a: '#111827', b: '#374151', c: '#2563eb' },
        forest: { name: 'Forest', a: '#14532d', b: '#16a34a', c: '#ca8a04' },
        crimson: { name: 'Crimson', a: '#450a0a', b: '#b91c1c', c: '#0ea5e9' }
    };
    P.TYPES = {
        summary: { label: 'Summary', icon: 'home', what: 'Cover, headline KPIs, highlights and your commentary' },
        tb: { label: 'Trial balance', icon: 'scale', what: 'Every account: opening, debits, credits, closing — by type, opens into accounts' },
        statement: { label: 'Statement', icon: 'file', what: 'Income statement, balance sheet, cash flow or any template — lines open into accounts' },
        kpis: { label: 'KPIs', icon: 'gauge', what: 'Every KPI: this month, last month, a year ago' },
        charts: { label: 'Charts', icon: 'chart', what: 'Revenue and profit trend, margins, profit bridge' },
        monitor: { label: 'Monitors', icon: 'bell', what: 'Monitors and covenants with their status' },
        text: { label: 'Text', icon: 'text', what: 'A page of your own text (Markdown: # headings, **bold**, - lists)' }
    };
    var ICON = {
        home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
        scale: 'M12 3v18M5 7h14M5 7l-3 7a4 4 0 0 0 6 0zM19 7l-3 7a4 4 0 0 0 6 0zM8 21h8',
        file: 'M6 2h9l5 5v15H6zM14 2v6h6M9 13h8M9 17h8M9 9h3',
        gauge: 'M12 14l4-4M3.5 17a9 9 0 1 1 17 0',
        chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
        bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0',
        text: 'M4 6h16M4 12h16M4 18h10',
        print: 'M6 9V3h12v6M6 18H4v-6h16v6h-2M8 14h8v7H8z',
        moon: 'M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z',
        dl: 'M12 3v12M7 10l5 5 5-5M4 21h16',
        menu: 'M3 6h18M3 12h18M3 18h18'
    };
    P.svg = function (k, s) { return '<svg width="' + (s || 16) + '" height="' + (s || 16) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="' + (ICON[k] || ICON.file) + '"/></svg>'; };

    /** A new pack: Summary, Trial balance, Income statement, Balance sheet, Cash flow, KPIs, Charts */
    P.newPack = function (name) {
        var by = function (kind) { return (FL.templates || []).filter(function (t) { return t.type === kind; })[0]; };
        var pl = by('PL'), bs = by('BS'), cf = by('CF');
        var id = function () { return 's' + Math.random().toString(36).slice(2, 8); };
        var s = [{ id: id(), type: 'summary', title: 'Summary', on: true, opts: { kpis: true, highlights: true, attention: true, note: '' } },
            { id: id(), type: 'tb', title: 'Trial Balance', on: true, opts: { range: 'YTD', group: 'type', zero: false } }];
        if (pl) s.push({ id: id(), type: 'statement', title: 'Income Statement', on: true, opts: { tpl: pl.id, cols: '_tpl', detail: true, hideZero: true } });
        if (bs) s.push({ id: id(), type: 'statement', title: 'Balance Sheet', on: true, opts: { tpl: bs.id, cols: '_tpl', detail: true, hideZero: true } });
        if (cf) s.push({ id: id(), type: 'statement', title: 'Cash Flow', on: true, opts: { tpl: cf.id, cols: '_tpl', detail: false, hideZero: true } });
        s.push({ id: id(), type: 'kpis', title: 'Key indicators', on: true, opts: {} });
        s.push({ id: id(), type: 'charts', title: 'Performance', on: true, opts: { trend: true, margins: true, bridge: true } });
        return { id: 'p' + Date.now().toString(36), name: name || 'Monthly board pack', title: 'Monthly board pack', company: (FL.config.pack && FL.config.pack.company) || 'Grays Group',
            by: (FL.who && FL.who.user) || '', theme: 'navy', logo: '', scale: 0, sections: s,
            email: { to: '', cc: '', subject: '{TITLE} · {PERIOD}', intro: 'Dear all,\n\nPlease find the {PERIOD} board pack below. The full interactive pack is attached — open it in any browser and use the menu on the left.\n\nKind regards,' } };
    };

    var winOf = function (range, per) {
        var list = FL.dims.periods, i = list.map(function (p) { return p.period_seq; }).indexOf(per), p = list[i] || {};
        if (range === 'MTD') return [per];
        if (range === 'QTD') return list.filter(function (x) { return x.fiscal_year === p.fiscal_year && x.quarter === p.quarter && x.period_seq <= per; }).map(function (x) { return x.period_seq; });
        if (range === 'LTM') return list.slice(Math.max(0, i - 11), i + 1).map(function (x) { return x.period_seq; });
        return list.filter(function (x) { return x.fiscal_year === p.fiscal_year && x.period_seq <= per; }).map(function (x) { return x.period_seq; });
    };
    var TYPE = { A: 'Assets', L: 'Liabilities', O: 'Equity', R: 'Revenue', E: 'Expenses' }, ORDER = { A: 1, L: 2, O: 3, R: 4, E: 5 };
    var csvCell = function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var csvOf = function (head, rows) { return [head.map(csvCell).join(',')].concat(rows.map(function (r) { return r.map(csvCell).join(','); })).join('\r\n'); };
    var md = function (t) {
        var h = esc(t || '');
        h = h.replace(/^### (.*)$/gm, '<h4>$1</h4>').replace(/^## (.*)$/gm, '<h3>$1</h3>').replace(/^# (.*)$/gm, '<h2 class="mh">$1</h2>')
            .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|\W)_(.+?)_(?=\W|$)/g, '$1<i>$2</i>');
        h = h.replace(/(?:^|\n)((?:- .*(?:\n|$))+)/g, function (m, block) { return '\n<ul>' + block.trim().split('\n').map(function (l) { return '<li>' + l.replace(/^- /, '') + '</li>'; }).join('') + '</ul>'; });
        return h.split(/\n{2,}/).map(function (p) { return /^\s*<(h\d|ul)/.test(p) ? p : '<p>' + p.replace(/\n/g, '<br>') + '</p>'; }).join('');
    };

    /** The statement of one template for the pack (+ account detail rows when asked) */
    function stmtSection(sec, data, per) {
        var t = FL.tpl(sec.opts.tpl);
        if (!t) return { html: '<p class="muted">Template ' + esc(sec.opts.tpl) + ' no longer exists — choose another in the designer.</p>' };
        var kind = /^(PL|BS|CF)$/.test(t.type) ? t.type : 'PL';
        var opts = { period: per, scale: FL.filter.scale };
        if (sec.opts.cols && sec.opts.cols !== '_tpl' && kind !== 'CF') opts.columns = FINE.colset(kind, sec.opts.cols);
        var st = FINE.compute(t, data, opts);
        var vcols = st.columns.map(function (c, i) { return i; });
        var rows = st.rows.filter(function (r) {
            if (r.hidden) return false;
            if (sec.opts.hideZero && r.type === 'accounts' && r.values.every(function (v, i) { return st.columns[i].kind !== 'value' || !v || Math.abs(v) < 0.5; })) return false;
            return true;
        });
        var h = '<table class="st"><thead><tr><th>in ' + esc(FL.scaleLabel()) + '</th>' + st.columns.map(function (c) { return '<th>' + esc(c.label) + '</th>'; }).join('') + '</tr></thead><tbody>';
        var csv = [];
        rows.forEach(function (r, k) {
            var sub = [];
            if (sec.opts.detail && r.type === 'accounts' && r.accounts && r.accounts.length) {
                var per1 = {};
                st.columns.forEach(function (c) { if (c.kind === 'value') FINE.explain(t, data, opts, r.id, c.id).forEach(function (a) { (per1[a.code] = per1[a.code] || { code: a.code, name: a.name, raw: {} }).raw[c.id] = a.amount; }); });
                sub = Object.keys(per1).sort().map(function (code) {
                    var a = per1[code];
                    a.values = st.columns.map(function (c) {
                        if (c.kind === 'value') return a.raw[c.id] == null ? 0 : a.raw[c.id] / st.scale;
                        if (c.kind === 'var') { var va = a.raw[c.a] || 0, vb = a.raw[c.b] || 0, d = (va - vb) * (r.favourable === 'down' ? -1 : 1); return c.mode === 'pct' ? (vb ? d / Math.abs(vb) * 100 : null) : d / st.scale; }
                        return null;
                    });
                    return a;
                }).filter(function (a) { return a.values.some(function (v) { return v && Math.abs(v) >= 0.5; }); });
            }
            var gid = sec.id + '_' + k, lv = (r.level || 0) * 16;
            h += '<tr class="' + FL.rowClass(r) + (sub.length ? ' grp' : '') + '"' + (sub.length ? ' data-g="' + gid + '"' : '') + '><td><span style="padding-left:' + lv + 'px">' + (sub.length ? '<i class="cr"></i>' : '') + esc(r.label || '') + '</span></td>' +
                st.columns.map(function (c, i) { var v = r.values[i], cls = c.kind === 'var' && v != null && Math.abs(v) > 1e-9 ? (v > 0 ? 'fav' : 'unf') : ''; return '<td class="' + cls + '">' + FL.cellText(r, c, v) + '</td>'; }).join('') + '</tr>';
            sub.forEach(function (a) {
                h += '<tr class="acc" data-p="' + gid + '"><td><span style="padding-left:' + (lv + 22) + 'px">' + esc(a.name && a.name !== a.code ? a.code + ' ' + a.name : a.code) + '</span></td>' + st.columns.map(function (c, i) { return '<td>' + FL.cellText(r, c, a.values[i]) + '</td>'; }).join('') + '</tr>';
                csv.push([r.label, a.code, a.name].concat(vcols.map(function (i) { return a.values[i] == null ? '' : +a.values[i].toFixed(2); })));
            });
            if (r.type !== 'blank') csv.push([r.label, '', ''].concat(vcols.map(function (i) { var v = r.values[i]; return v == null ? '' : +(+v).toFixed(2); })));
        });
        h += '</tbody></table>';
        return { html: h, csv: csvOf(['Line', 'Account', 'Name'].concat(st.columns.map(function (c) { return c.label; })), csv), sub: t.name + ' · ' + FL.periodName(per), st: st, tpl: t, collapsible: !!sec.opts.detail };
    }

    /** Trial balance straight from fin_balances, grouped by type (opens into accounts) or every account */
    function tbSection(sec, per) {
        var seqs = winOf(sec.opts.range || 'YTD', per); if (!seqs.length) seqs = [per];
        var first = Math.min.apply(null, seqs), last = Math.max.apply(null, seqs);
        var w = FL.where('b').concat(["b.scenario = 'ACTUAL'", 'b.period_seq IN (' + seqs.join(',') + ')']);
        var sql = 'SELECT b.account, SUM(CASE WHEN b.period_seq = ' + first + ' THEN b.begin_bal ELSE 0 END) AS opening, SUM(b.period_dr) AS dr, SUM(b.period_cr) AS cr, ' +
            'SUM(CASE WHEN b.period_seq = ' + last + ' THEN b.end_bal ELSE 0 END) AS closing FROM fin_balances b WHERE ' + w.join(' AND ') + ' GROUP BY ALL';
        return FL.rows(sql, 500000).then(function (rows) {
            var acc = {}; FL.dims.accounts.forEach(function (a) { acc[a.code] = a; });
            rows.forEach(function (r) { var a = acc[r.account] || {}; r.name = a.name || ''; r.type = a.account_type || '?'; r.cls = a.class || ''; });
            if (!sec.opts.zero) rows = rows.filter(function (r) { return [r.opening, r.dr, r.cr, r.closing].some(function (v) { return Math.abs(v) >= 0.005; }); });
            rows.sort(function (a, b) { return (ORDER[a.type] || 9) - (ORDER[b.type] || 9) || String(a.account).localeCompare(String(b.account), undefined, { numeric: true }); });
            var sc = FL.filter.scale || 1, dec = sc >= 1000 ? 0 : 2;
            var f = function (v) { return Math.abs(v) < 0.005 ? '–' : FINE.fmt(v / sc, 'num', { decimals: dec }); };
            var dc = function (v, side) { return side === 'dr' ? (v > 0.005 ? f(v) : '') : (v < -0.005 ? f(-v) : ''); };
            var cells = function (r) { return '<td>' + f(r.opening) + '</td><td>' + f(r.dr) + '</td><td>' + f(r.cr) + '</td><td>' + f(r.dr - r.cr) + '</td><td>' + dc(r.closing, 'dr') + '</td><td>' + dc(r.closing, 'cr') + '</td>'; };
            var tot = { opening: 0, dr: 0, cr: 0, closing: 0, cdr: 0, ccr: 0 };
            rows.forEach(function (r) { tot.opening += r.opening; tot.dr += r.dr; tot.cr += r.cr; tot.closing += r.closing; if (r.closing >= 0) tot.cdr += r.closing; else tot.ccr -= r.closing; });
            var byType = sec.opts.group !== 'account', h = '<table class="st tb"><thead><tr><th>Account</th><th>Opening</th><th>Debits</th><th>Credits</th><th>Net movement</th><th>Closing debit</th><th>Closing credit</th></tr></thead><tbody>';
            if (byType) {
                var g = {}; rows.forEach(function (r) { (g[r.type] = g[r.type] || []).push(r); });
                Object.keys(g).sort(function (a, b) { return (ORDER[a] || 9) - (ORDER[b] || 9); }).forEach(function (ty) {
                    var s = { opening: 0, dr: 0, cr: 0, closing: 0 }; g[ty].forEach(function (r) { s.opening += r.opening; s.dr += r.dr; s.cr += r.cr; s.closing += r.closing; });
                    var gid = sec.id + '_' + ty;
                    h += '<tr class="grp b" data-g="' + gid + '"><td><i class="cr"></i>' + esc(TYPE[ty] || 'Other') + ' <span class="n">(' + g[ty].length + ')</span></td>' + cells(s) + '</tr>';
                    g[ty].forEach(function (r) { h += '<tr class="acc" data-p="' + gid + '"><td><span style="padding-left:22px">' + esc(r.name && r.name !== r.account ? r.account + ' ' + r.name : r.account) + '</span></td>' + cells(r) + '</tr>'; });
                });
            } else rows.forEach(function (r) { h += '<tr><td>' + esc(r.name && r.name !== r.account ? r.account + ' ' + r.name : r.account) + '</td>' + cells(r) + '</tr>'; });
            h += '<tr class="b tb db"><td>Total</td><td>' + f(tot.opening) + '</td><td>' + f(tot.dr) + '</td><td>' + f(tot.cr) + '</td><td>' + f(tot.dr - tot.cr) + '</td><td>' + f(tot.cdr) + '</td><td>' + f(tot.ccr) + '</td></tr></tbody></table>';
            var okM = Math.abs(tot.dr - tot.cr) < 1, okB = Math.abs(tot.closing) < 1;
            var badge = '<div class="chips"><span class="chip ' + (okM ? 'ok' : 'bad') + '">' + (okM ? '✓ debits = credits' : '✗ debits ≠ credits ' + f(tot.dr - tot.cr)) + '</span><span class="chip ' + (okB ? 'ok' : 'bad') + '">' + (okB ? '✓ closing balances net to nil' : '✗ closing balances net to ' + f(tot.closing)) + '</span><span class="chip">' + rows.length + ' accounts</span></div>';
            return { html: badge + h, csv: csvOf(['Account', 'Name', 'Type', 'Class', 'Opening', 'Debits', 'Credits', 'Net', 'Closing'], rows.map(function (r) { return [r.account, r.name, TYPE[r.type] || r.type, r.cls, r.opening.toFixed(2), r.dr.toFixed(2), r.cr.toFixed(2), (r.dr - r.cr).toFixed(2), r.closing.toFixed(2)]; })),
                sub: ({ MTD: 'Month', QTD: 'Quarter to date', YTD: 'Year to date', LTM: 'Last 12 months' }[sec.opts.range || 'YTD']) + ' · ' + FL.periodName(first) + (first !== last ? ' – ' + FL.periodName(last) : ''), collapsible: byType };
        });
    }

    /** Builds the pack. → Promise<{html, file, model}> */
    P.build = function (pack, onStep) {
        var per = FL.filter.period, pname = FL.periodName(per), cfg = FL.config, tm = FL.tplMap(), keepScale = FL.filter.scale;
        if (pack.scale) FL.filter.scale = +pack.scale;
        var th = P.THEMES[pack.theme] || P.THEMES.navy, step = onStep || function () { };
        var done = function (x) { FL.filter.scale = keepScale; return x; };
        return FL.data().then(function (data) {
            var kv = {}, kPy = {}, kPm = {}, pi = data._pi, i = pi.bySeq[per];
            try { kv = FINE.kpis(cfg.kpis, tm, data, per); if (i > 0) kPm = FINE.kpis(cfg.kpis, tm, data, pi.list[i - 1].period_seq); var pyS = pi.bySeq[per - 100]; if (pyS != null) kPy = FINE.kpis(cfg.kpis, tm, data, per - 100); } catch (e) { console.warn('[pack] KPIs', e); }
            var kdef = function (id) { return (cfg.kpis || []).filter(function (k) { return k.id === id; })[0]; };
            var head = (cfg.headline || []).map(kdef).filter(Boolean).slice(0, 8);
            var tiles = head.map(function (k) {
                var v = (kv[k.id] || {}).value, py = (kPy[k.id] || {}).value, d = v != null && py != null ? v - py : null, good = d == null ? null : (k.good === 'down' ? d <= 0 : d >= 0);
                return { label: k.label, value: FL.kfmt(v, k.fmt), delta: d == null ? '' : FL.kdelta(d, k.fmt) + ' vs last year', good: good };
            });
            // P&L narrative + key lines (month / YTD / budget / last year)
            var plT = tm.PL || (FL.templates || []).filter(function (t) { return t.type === 'PL'; })[0], keyLines = [], hl = [];
            if (plT) {
                var pl = FINE.compute(plT, data, { period: per, scale: 1, columns: [{ id: 'm_act', scenario: 'ACTUAL', range: 'MTD' }, { id: 'm_bud', scenario: 'BUDGET', range: 'MTD' }, { id: 'y_act', scenario: 'ACTUAL', range: 'YTD' }, { id: 'y_bud', scenario: 'BUDGET', range: 'YTD' }, { id: 'y_py', scenario: 'ACTUAL', range: 'YTD', at: 'PY' }] });
                try {
                    hl = hl.concat(FINE.narrative(pl, 'y_act', 'y_bud', { keyRows: ['REV', 'EBITDA', 'NP'], top: 3, fmt: FL.compact }).map(function (x) { return 'Year to date vs budget — ' + x.text; }));
                    hl = hl.concat(FINE.narrative(pl, 'y_act', 'y_py', { keyRows: ['REV', 'NP'], top: 0, fmt: FL.compact }).map(function (x) { return 'Year to date vs last year — ' + x.text; }));
                } catch (e) { console.warn('[pack] narrative', e); }
                var want = ['REV', 'COGS', 'GP', 'OPEX', 'EBITDA', 'EBIT', 'PBT', 'NP'];
                var pick = pl.rows.filter(function (r) { return want.indexOf(r.id) >= 0 && r.format !== 'pct'; });
                if (pick.length < 3) pick = pl.rows.filter(function (r) { return (r.type === 'formula' || r.type === 'group') && r.format !== 'pct'; }).slice(0, 7);
                keyLines = pick.map(function (r) { return { label: r.label, bold: /GP|EBITDA|NP|PBT/.test(r.id) || (r.style || {}).bold, m: r.values[0], mb: r.values[1], y: r.values[2], yb: r.values[3], py: r.values[4] }; });
            }
            var mon = []; try { mon = FINE.monitor(cfg.monitors || [], kv); } catch (e) { /* no monitors */ }
            var attention = mon.filter(function (m) { return m.status === 'breach'; }).map(function (b) { var d = kdef(b.rule.kpi) || {}; return b.rule.label + ' — ' + (d.label || '') + ' at ' + FL.kfmt(b.value, d.fmt); });
            var trendPng = null;
            if (plT && FL.chartImg) {
                try {
                    var m = FL.monthly(data, plT, ['REV', 'NP'], { scenario: 'ACTUAL', range: 'MTD' }, 12);
                    trendPng = FL.chartImg({ data: { labels: m.labels, datasets: [{ type: 'bar', label: 'Revenue', data: m.series.REV, backgroundColor: th.b, order: 2 }, { type: 'line', label: 'Net profit', data: m.series.NP, borderColor: th.c, backgroundColor: th.c, yAxisID: 'y2', order: 0, pointRadius: 2 }] },
                        options: { scales: { y: FL.moneyAxis(), y2: Object.assign(FL.moneyAxis(), { position: 'right', grid: { display: false } }) } } }, 1200, 420);
                } catch (e) { console.warn('[pack] trend chart', e); }
            }
            var model = { period: pname, per: per, tiles: tiles, keyLines: keyLines, highlights: hl, attention: attention, trendPng: trendPng, scaleLabel: FL.scaleLabel(), filter: FL.filterText() };

            var out = [], chain = Promise.resolve();
            (pack.sections || []).filter(function (s) { return s.on !== false; }).forEach(function (sec) {
                chain = chain.then(function () {
                    step('Building ' + sec.title + '…');
                    if (sec.type === 'summary') {
                        var o = sec.opts || {};
                        var h = '<div class="hero"><div><div class="eyebrow">' + esc(pack.company || '') + '</div><h1>' + esc(pack.title || pack.name) + '</h1><div class="per">' + esc(pname) + '</div>' +
                            '<div class="meta">' + esc(model.filter) + ' · amounts in ' + esc(model.scaleLabel) + (pack.by ? ' · prepared by ' + esc(pack.by) : '') + ' · ' + new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) + '</div></div>' +
                            (pack.logo ? '<img class="logo" src="' + esc(pack.logo) + '" alt="">' : '') + '</div>';
                        if (o.kpis !== false && tiles.length) h += '<div class="tiles">' + tiles.map(function (t) { return '<div class="tile"><div class="tl">' + esc(t.label) + '</div><div class="tv">' + t.value + '</div><div class="td ' + (t.good == null ? '' : t.good ? 'pos' : 'neg') + '">' + esc(t.delta) + '</div></div>'; }).join('') + '</div>';
                        if (o.note) h += '<h3>Commentary</h3><div class="note">' + md(o.note) + '</div>';
                        if (o.highlights !== false && hl.length) h += '<h3>Highlights</h3><ul class="hl">' + hl.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
                        if (o.attention !== false) h += '<h3>Attention points</h3>' + (attention.length ? '<ul class="hl warn">' + attention.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '<p class="muted">All monitors are within their limits.</p>');
                        if (trendPng) h += '<h3>Revenue and net profit, last 12 months</h3><img class="wide" src="' + trendPng + '" alt="Revenue and net profit">';
                        out.push({ sec: sec, html: h });
                        return;
                    }
                    if (sec.type === 'tb') return tbSection(sec, per).then(function (r) { out.push({ sec: sec, html: r.html, csv: r.csv, sub: r.sub, collapsible: r.collapsible, search: true }); });
                    if (sec.type === 'statement') { var r = stmtSection(sec, data, per); out.push({ sec: sec, html: r.html, csv: r.csv, sub: r.sub, collapsible: r.collapsible, search: true }); return; }
                    if (sec.type === 'kpis') {
                        var groups = {}; (cfg.kpis || []).forEach(function (k) { (groups[k.group || 'Other'] = groups[k.group || 'Other'] || []).push(k); });
                        var rows = [];
                        var h2 = '<table class="st kp"><thead><tr><th>KPI</th><th>' + esc(pname) + '</th><th>Previous month</th><th>A year ago</th><th class="l">What it means</th></tr></thead><tbody>' +
                            Object.keys(groups).map(function (g) {
                                return '<tr class="header"><td colspan="5">' + esc(g) + '</td></tr>' + groups[g].map(function (k) {
                                    rows.push([g, k.label, (kv[k.id] || {}).value, (kPm[k.id] || {}).value, (kPy[k.id] || {}).value]);
                                    return '<tr><td>' + esc(k.label) + '</td><td><b>' + FL.kfmt((kv[k.id] || {}).value, k.fmt) + '</b></td><td>' + FL.kfmt((kPm[k.id] || {}).value, k.fmt) + '</td><td>' + FL.kfmt((kPy[k.id] || {}).value, k.fmt) + '</td><td class="l muted">' + esc(k.desc || (FL.KPI_GUIDE && FL.KPI_GUIDE[k.id]) || '') + '</td></tr>';
                                }).join('');
                            }).join('') + '</tbody></table>';
                        out.push({ sec: sec, html: h2, csv: csvOf(['Group', 'KPI', pname, 'Previous month', 'A year ago'], rows), search: true });
                        return;
                    }
                    if (sec.type === 'charts') {
                        if (!plT || !FL.chartImg) { out.push({ sec: sec, html: '<p class="muted">No income statement template to chart.</p>' }); return; }
                        var o2 = sec.opts || {}, parts = [];
                        var mm = FL.monthly(data, plT, ['REV', 'NP', 'GM', 'EBITDAM', 'NPM'], { scenario: 'ACTUAL', range: 'MTD' }, 24), bb = FL.monthly(data, plT, ['REV'], { scenario: 'BUDGET', range: 'MTD' }, 24);
                        if (o2.trend !== false) parts.push('<figure><img class="wide" src="' + FL.chartImg({ data: { labels: mm.labels, datasets: [{ type: 'bar', label: 'Revenue', data: mm.series.REV, backgroundColor: th.b, order: 2 }, { type: 'line', label: 'Budget revenue', data: bb.series.REV, borderColor: '#94a3b8', borderDash: [5, 4], pointRadius: 0, order: 1 }, { type: 'line', label: 'Net profit', data: mm.series.NP, borderColor: th.c, yAxisID: 'y2', order: 0 }] }, options: { scales: { y: FL.moneyAxis(), y2: Object.assign(FL.moneyAxis(), { position: 'right', grid: { display: false } }) } } }, 1200, 400) + '"><figcaption>Revenue against budget and net profit, last 24 months</figcaption></figure>');
                        var two = [];
                        if (o2.margins !== false) two.push('<figure><img src="' + FL.chartImg({ type: 'line', data: { labels: mm.labels, datasets: [{ label: 'Gross margin %', data: mm.series.GM, borderColor: th.b, pointRadius: 0 }, { label: 'EBITDA margin %', data: mm.series.EBITDAM, borderColor: th.c, pointRadius: 0 }, { label: 'Net margin %', data: mm.series.NPM, borderColor: '#64748b', pointRadius: 0 }] } }, 600, 340) + '"><figcaption>Margins, monthly</figcaption></figure>');
                        if (o2.bridge !== false) {
                            try {
                                var pl2 = FINE.compute(plT, data, { period: per, scale: 1, columns: [{ id: 'y_act', scenario: 'ACTUAL', range: 'YTD' }, { id: 'y_py', scenario: 'ACTUAL', range: 'YTD', at: 'PY' }] });
                                var steps = FINE.bridge(pl2, 'y_py', 'y_act', 'NP', 'NP', [{ id: 'REV', label: 'Revenue' }, { id: 'COGS', label: 'Cost of sales', sign: -1 }, { id: 'OPEX', label: 'Opex', sign: -1 }, { id: 'OI', label: 'Other inc.' }, { id: 'DA', label: 'D&A', sign: -1 }, { id: 'FIN', label: 'Finance', sign: -1 }, { id: 'TAX', label: 'Tax', sign: -1 }]);
                                var run = 0, bars = steps.map(function (s) { if (s.kind !== 'step') { run = s.value; return [0, s.value]; } var r2 = [run, run + s.value]; run += s.value; return r2; });
                                two.push('<figure><img src="' + FL.chartImg({ type: 'bar', data: { labels: steps.map(function (s) { return s.kind === 'start' ? 'YTD last year' : s.kind === 'end' ? 'YTD this year' : s.label; }), datasets: [{ data: bars, backgroundColor: steps.map(function (s) { return s.kind !== 'step' ? th.a : s.value >= 0 ? '#16a34a' : '#dc2626'; }) }] }, options: { plugins: { legend: { display: false } }, scales: { y: FL.moneyAxis() } } }, 600, 340) + '"><figcaption>Net profit bridge, year to date: last year → this year</figcaption></figure>');
                            } catch (e) { console.warn('[pack] bridge', e); }
                        }
                        if (two.length) parts.push('<div class="two">' + two.join('') + '</div>');
                        out.push({ sec: sec, html: parts.join('') || '<p class="muted">No charts chosen.</p>' });
                        return;
                    }
                    if (sec.type === 'monitor') {
                        out.push({ sec: sec, html: mon.length ? '<table class="st kp"><thead><tr><th>Rule</th><th class="l">Severity</th><th>Value</th><th class="l">Status</th></tr></thead><tbody>' + mon.map(function (m) { var d = kdef(m.rule.kpi) || {}; return '<tr><td>' + esc(m.rule.label) + '</td><td class="l">' + esc(m.rule.severity || '') + '</td><td>' + FL.kfmt(m.value, d.fmt) + '</td><td class="l"><span class="chip ' + (m.status === 'breach' ? 'bad' : m.status === 'ok' ? 'ok' : '') + '">' + (m.status === 'breach' ? 'ALERT' : m.status === 'ok' ? 'OK' : 'n/a') + '</span></td></tr>'; }).join('') + '</tbody></table>' : '<p class="muted">No monitors set up.</p>', search: true });
                        return;
                    }
                    if (sec.type === 'text') { out.push({ sec: sec, html: '<div class="prose">' + md((sec.opts || {}).text || '') + '</div>' }); return; }
                });
            });
            return chain.then(function () {
                var file = ((pack.title || pack.name || 'Board pack') + ' ' + pname).replace(/[^\w .-]+/g, '').replace(/\s+/g, ' ').trim() + '.html';
                return done({ html: page(pack, th, pname, out), file: file, model: model, sections: out.map(function (x) { return x.sec.title; }) });
            });
        }).catch(function (e) { done(); throw e; });
    };

    /** The self-contained interactive page */
    function page(pack, th, pname, out) {
        var css = ':root{--a:' + th.a + ';--b:' + th.b + ';--c:' + th.c + ';--bg:#f4f6fb;--card:#fff;--ink:#0f172a;--mut:#64748b;--line:#e5e9f2;--row:#f8fafc}' +
            'html[data-theme=dark]{--bg:#0b1020;--card:#121a2e;--ink:#e5e9f5;--mut:#93a0bb;--line:#24304d;--row:#17213a}' +
            '*{box-sizing:border-box}body{margin:0;font:14px/1.5 "Segoe UI",system-ui,-apple-system,Arial,sans-serif;background:var(--bg);color:var(--ink)}' +
            '.app{display:grid;grid-template-columns:260px minmax(0,1fr);min-height:100vh}' +
            'nav{background:var(--a);color:#fff;position:sticky;top:0;height:100vh;display:flex;flex-direction:column;padding:18px 12px;gap:2px}' +
            'nav .co{font-size:11px;letter-spacing:.18em;text-transform:uppercase;opacity:.7;padding:0 10px}nav .tt{font-size:18px;font-weight:800;padding:2px 10px 0;line-height:1.25}nav .pp{display:inline-block;margin:8px 10px 14px;background:rgba(255,255,255,.14);border-radius:99px;padding:3px 12px;font-size:12px;font-weight:700}' +
            'nav a{display:flex;align-items:center;gap:10px;color:rgba(255,255,255,.82);text-decoration:none;padding:9px 12px;border-radius:9px;font-weight:600;cursor:pointer}nav a:hover{background:rgba(255,255,255,.08);color:#fff}nav a.on{background:#fff;color:var(--a)}' +
            'nav .grow{flex:1}nav .tools{display:flex;gap:6px;padding:8px 6px 0;border-top:1px solid rgba(255,255,255,.14)}nav .tools button{flex:1;display:flex;gap:6px;align-items:center;justify-content:center;background:rgba(255,255,255,.1);border:0;color:#fff;border-radius:8px;padding:8px;font:inherit;font-size:12px;cursor:pointer}nav .tools button:hover{background:rgba(255,255,255,.2)}' +
            'nav .logo{max-width:150px;max-height:48px;margin:0 10px 10px;object-fit:contain;background:#fff;border-radius:6px;padding:4px}' +
            'main{padding:26px 34px 60px;min-width:0}section{display:none;animation:fi .25s ease}section.on{display:block}@keyframes fi{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}' +
            '.sh{display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-bottom:14px}.sh h2{margin:0;font-size:24px;letter-spacing:-.01em}.sh .sub{color:var(--mut);font-size:13px}.sh .gr{flex:1}' +
            '.sh input{border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:8px;padding:7px 10px;font:inherit;width:210px}.btn{border:1px solid var(--line);background:var(--card);color:var(--ink);border-radius:8px;padding:7px 11px;font:inherit;font-size:13px;cursor:pointer;display:inline-flex;gap:6px;align-items:center}.btn:hover{border-color:var(--b);color:var(--b)}' +
            '.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 20px;box-shadow:0 1px 2px rgba(15,23,42,.04)}.scroll{overflow-x:auto}' +
            'table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}table.st th{position:sticky;top:0;background:var(--a);color:#fff;text-align:right;padding:8px 10px;font-size:12px;font-weight:600;white-space:nowrap}table.st th:first-child,table.st th.l{text-align:left}' +
            'table.st td{padding:6px 10px;text-align:right;white-space:nowrap;border-bottom:1px solid var(--line)}table.st td:first-child,table.st td.l{text-align:left;white-space:normal}table.st tbody tr:hover td{background:var(--row)}' +
            'tr.header td{font-weight:700;color:var(--a);padding-top:12px;background:transparent}html[data-theme=dark] tr.header td{color:#c7d2fe}tr.blank td{height:8px;border:0}tr.text td{color:var(--mut);font-style:italic}tr.b td{font-weight:700}tr.i td{font-style:italic}tr.m td{color:var(--mut)}' +
            'tr.tb td{border-top:1.5px solid var(--ink)}tr.db td{border-bottom:3px double var(--ink)}tr.check td{font-size:12px;color:var(--mut)}tr.check.notok td{color:#dc2626;font-weight:700}td.fav{color:#16a34a}td.unf{color:#dc2626}' +
            'tr.grp{cursor:pointer}tr.grp .cr{display:inline-block;width:0;height:0;border-left:5px solid currentColor;border-top:4px solid transparent;border-bottom:4px solid transparent;margin-right:8px;transition:transform .15s;vertical-align:middle}tr.grp.open .cr{transform:rotate(90deg)}' +
            'tr.acc{display:none}tr.acc.show{display:table-row}tr.acc td{font-size:12.5px;color:var(--mut);background:var(--row)}tr.hide{display:none!important}' +
            '.hero{display:flex;gap:20px;align-items:center;background:linear-gradient(135deg,var(--a),var(--b) 65%,var(--c));color:#fff;border-radius:18px;padding:30px 34px;margin-bottom:18px}.hero>div{flex:1}.hero h1{margin:4px 0;font-size:30px}.hero .eyebrow{letter-spacing:.2em;text-transform:uppercase;font-size:12px;opacity:.8}.hero .per{font-size:22px;font-weight:800;margin:6px 0}.hero .meta{opacity:.85;font-size:13px}.hero .logo{max-height:70px;max-width:180px;background:#fff;border-radius:10px;padding:6px}' +
            '.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px;margin-bottom:8px}.tile{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;border-top:4px solid var(--b)}.tl{font-size:12px;color:var(--mut);font-weight:600}.tv{font-size:24px;font-weight:800;margin:2px 0}.td{font-size:12px;color:var(--mut)}.pos{color:#16a34a}.neg{color:#dc2626}' +
            'h3{font-size:15px;margin:22px 0 8px;color:var(--a)}html[data-theme=dark] h3{color:#c7d2fe}.note{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--b);border-radius:10px;padding:10px 16px}.note p{margin:6px 0}ul.hl{margin:0;padding:0;list-style:none}ul.hl li{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:9px 14px;margin:6px 0;border-left:4px solid var(--c)}ul.hl.warn li{border-left-color:#dc2626}' +
            '.muted{color:var(--mut)}img.wide{width:100%;border-radius:10px;background:#fff}.two{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px}.two img{width:100%;border-radius:10px;background:#fff}figure{margin:0}figcaption{color:var(--mut);font-size:12px;text-align:center;margin-top:4px}' +
            '.chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}.chip{border:1px solid var(--line);border-radius:99px;padding:3px 11px;font-size:12px;font-weight:600;background:var(--card)}.chip.ok{color:#15803d;border-color:#bbf7d0;background:#f0fdf4}.chip.bad{color:#b91c1c;border-color:#fecaca;background:#fef2f2}' +
            'tr.none td{text-align:center!important;color:var(--mut);padding:18px}.prose{max-width:820px}.prose h2.mh{font-size:20px}.foot{color:var(--mut);font-size:12px;margin-top:26px;text-align:center}.mtop{display:none}' +
            '@media (max-width:860px){.app{grid-template-columns:1fr}nav{position:sticky;height:auto;flex-direction:row;flex-wrap:nowrap;overflow-x:auto;padding:8px;z-index:5}nav .co,nav .tt,nav .pp,nav .grow,nav .logo{display:none}nav a{white-space:nowrap;padding:8px 10px}nav .tools{border:0;padding:0}main{padding:16px}table.st td:first-child{min-width:170px}.two{grid-template-columns:1fr}.hero{padding:20px}.sh input{width:100%}}' +
            '@media print{@page{size:A4 landscape;margin:10mm}nav,.sh input,.sh .btn{display:none!important}.app{display:block}main{padding:0}section{display:none;page-break-after:always}section.on,body.all section{display:block}tr.acc.show{display:table-row}.card{border:0;box-shadow:none;padding:0}table.st th{background:#13315c!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.hero,.tile{-webkit-print-color-adjust:exact;print-color-adjust:exact}}';
        var nav = out.map(function (x, k) { var t = P.TYPES[x.sec.type] || {}; return '<a data-s="' + k + '" href="#' + esc(x.sec.id) + '">' + P.svg(t.icon) + '<span>' + esc(x.sec.title) + '</span></a>'; }).join('');
        var secs = out.map(function (x, k) {
            var tools = (x.search ? '<input type="search" placeholder="Search this page…" data-q="' + k + '">' : '') + (x.collapsible ? '<button class="btn" data-x="' + k + '" title="Open or close every line">Expand all</button>' : '') +
                (x.csv ? '<button class="btn" data-csv="' + k + '">' + P.svg('dl', 14) + ' CSV</button>' : '') + '<button class="btn" data-pr="1">' + P.svg('print', 14) + ' Print</button>';
            return '<section id="' + esc(x.sec.id) + '" data-k="' + k + '">' + (x.sec.type === 'summary' ? '' : '<div class="sh"><div><h2>' + esc(x.sec.title) + '</h2><div class="sub">' + esc(x.sub || pname) + ' · amounts in ' + esc(FL.scaleLabel()) + '</div></div><span class="gr"></span>' + tools + '</div>') +
                '<div class="' + (x.sec.type === 'summary' || x.sec.type === 'charts' || x.sec.type === 'text' ? '' : 'card scroll') + '">' + x.html + '</div>' +
                (x.csv ? '<script type="text/plain" id="csv' + k + '" data-name="' + esc(x.sec.title + ' ' + pname) + '.csv">' + x.csv.replace(/<\//g, '<\\/') + '</script>' : '') + '</section>';
        }).join('');
        var js = '(function(){var S=[].slice.call(document.querySelectorAll("section")),A=[].slice.call(document.querySelectorAll("nav a[data-s]"));' +
            'function go(k){S.forEach(function(s,i){s.classList.toggle("on",i==k)});A.forEach(function(a,i){a.classList.toggle("on",i==k)});window.scrollTo(0,0)}' +
            'function fromHash(){var h=decodeURIComponent(location.hash.slice(1)),k=0;S.forEach(function(s,i){if(s.id===h)k=i});go(k)}window.addEventListener("hashchange",fromHash);fromHash();' +
            'document.addEventListener("keydown",function(e){if(/INPUT|TEXTAREA/.test(e.target.tagName))return;var k=S.findIndex(function(s){return s.classList.contains("on")});if(e.key==="ArrowDown"||e.key==="j"){k=Math.min(S.length-1,k+1)}else if(e.key==="ArrowUp"||e.key==="k"){k=Math.max(0,k-1)}else return;location.hash=S[k].id;e.preventDefault()});' +
            'document.addEventListener("click",function(e){var g=e.target.closest("tr.grp");if(g){var o=!g.classList.contains("open");g.classList.toggle("open",o);document.querySelectorAll(\'tr[data-p="\'+g.dataset.g+\'"]\').forEach(function(r){r.classList.toggle("show",o)});return}' +
            'var x=e.target.closest("[data-x]");if(x){var sec=x.closest("section"),gs=sec.querySelectorAll("tr.grp"),open=x.textContent.indexOf("Expand")>=0;gs.forEach(function(g){g.classList.toggle("open",open);sec.querySelectorAll(\'tr[data-p="\'+g.dataset.g+\'"]\').forEach(function(r){r.classList.toggle("show",open)})});x.textContent=open?"Collapse all":"Expand all";return}' +
            'var c=e.target.closest("[data-csv]");if(c){var t=document.getElementById("csv"+c.dataset.csv),b=new Blob(["\\ufeff"+t.textContent],{type:"text/csv"}),a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=t.dataset.name;document.body.appendChild(a);a.click();setTimeout(function(){a.remove()},500);return}' +
            'if(e.target.closest("[data-pr]")){document.body.classList.remove("all");window.print();return}if(e.target.closest("#prall")){document.body.classList.add("all");window.print();setTimeout(function(){document.body.classList.remove("all")},500);return}' +
            'if(e.target.closest("#theme")){var d=document.documentElement,n=d.dataset.theme==="dark"?"light":"dark";d.dataset.theme=n;try{localStorage.setItem("pack.theme",n)}catch(_){}}});' +
            'document.addEventListener("input",function(e){var q=e.target.dataset&&e.target.dataset.q;if(q==null)return;var v=e.target.value.toLowerCase().trim(),sec=e.target.closest("section");sec.querySelectorAll("tbody tr").forEach(function(r){var hit=!v||r.textContent.toLowerCase().indexOf(v)>=0;r.classList.toggle("hide",!hit);if(v&&hit&&r.classList.contains("acc"))r.classList.add("show")});' +
            'var tb=sec.querySelector("tbody");if(tb){var nn=tb.querySelector("tr.none");if(nn)nn.remove();if(v&&![].some.call(tb.querySelectorAll("tr"),function(r){return !r.classList.contains("hide")})){var z=document.createElement("tr");z.className="none";z.innerHTML="<td colspan=\'20\'>Nothing on this page matches \u201c"+e.target.value.replace(/[<>&]/g,"")+"\u201d</td>";tb.appendChild(z)}}' +
            'if(v)sec.querySelectorAll("tr.grp").forEach(function(g){if([].some.call(sec.querySelectorAll(\'tr[data-p="\'+g.dataset.g+\'"]\'),function(r){return !r.classList.contains("hide")})){g.classList.remove("hide");g.classList.add("open")}})});' +
            'try{var t=localStorage.getItem("pack.theme");if(t)document.documentElement.dataset.theme=t;else if(matchMedia("(prefers-color-scheme: dark)").matches)document.documentElement.dataset.theme="dark"}catch(_){}})();';
        return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="generator" content="Finance Lens">' +
            '<title>' + esc((pack.title || pack.name) + ' — ' + pname) + '</title><style>' + css + '</style></head><body><div class="app"><nav>' +
            (pack.logo ? '<img class="logo" src="' + esc(pack.logo) + '" alt="">' : '') + '<div class="co">' + esc(pack.company || '') + '</div><div class="tt">' + esc(pack.title || pack.name) + '</div><div><span class="pp">' + esc(pname) + '</span></div>' + nav +
            '<span class="grow"></span><div class="tools"><button id="prall" title="Print every page of the pack">' + P.svg('print', 14) + ' Print all</button><button id="theme" title="Light / dark">' + P.svg('moon', 14) + '</button></div></nav>' +
            '<main>' + secs + '<div class="foot">' + esc(pack.company || '') + ' · ' + esc(pack.title || pack.name) + ' · ' + esc(pname) + ' · generated by Finance Lens on ' + esc(new Date().toLocaleString('en-GB')) + ' from the general ledger</div></main></div><script>' + js + '</script></body></html>';
    }

    /** Outlook-safe message body. opts: {intro, tiles, keyLines, highlights, chart: 'cid:…' | data URL | null, attached: file name} */
    P.emailHtml = function (pack, model, opts) {
        opts = opts || {};
        var th = P.THEMES[pack.theme] || P.THEMES.navy, F = 'font-family:Segoe UI,Arial,Helvetica,sans-serif;';
        var fill = function (s) { return String(s || '').replace(/\{PERIOD\}/g, model.period).replace(/\{TITLE\}/g, pack.title || pack.name).replace(/\{COMPANY\}/g, pack.company || ''); };
        var n = function (v) { return v == null || isNaN(v) ? '–' : FINE.fmt(v / (FL.filter.scale || 1), 'num', { decimals: (FL.filter.scale || 1) >= 1000 ? 0 : 2 }); };
        var h = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#eef1f7">' +
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#eef1f7" style="background:#eef1f7"><tr><td align="center" style="padding:24px 10px">' +
            '<table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:640px;max-width:640px;background:#ffffff;border-radius:12px">' +
            '<tr><td bgcolor="' + th.a + '" style="background:' + th.a + ';padding:26px 30px;border-radius:12px 12px 0 0;' + F + 'color:#ffffff">' +
            '<div style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#cbd5e1">' + esc(pack.company || '') + '</div>' +
            '<div style="font-size:24px;font-weight:bold;margin-top:4px;color:#ffffff">' + esc(pack.title || pack.name) + '</div>' +
            '<div style="font-size:16px;margin-top:6px;color:#e2e8f0">' + esc(model.period) + ' &middot; ' + esc(model.filter) + '</div></td></tr>' +
            '<tr><td bgcolor="' + th.c + '" style="background:' + th.c + ';height:4px;line-height:4px;font-size:0">&nbsp;</td></tr>';
        if (opts.intro) h += '<tr><td style="padding:22px 30px 6px;' + F + 'font-size:14px;line-height:1.6;color:#1e293b">' + esc(fill(opts.intro)).replace(/\n/g, '<br>') + '</td></tr>';
        if (opts.tiles !== false && model.tiles.length) {
            var t = model.tiles.slice(0, 6), rowsH = '';
            for (var i = 0; i < t.length; i += 3) {
                rowsH += '<tr>' + t.slice(i, i + 3).map(function (x) {
                    return '<td width="33%" valign="top" style="padding:6px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2e8f0;border-top:3px solid ' + th.b + ';border-radius:8px"><tr><td style="padding:10px 12px;' + F + '">' +
                        '<div style="font-size:11px;color:#64748b;font-weight:bold">' + esc(x.label) + '</div><div style="font-size:20px;font-weight:bold;color:#0f172a;margin:2px 0">' + x.value + '</div>' +
                        '<div style="font-size:11px;color:' + (x.good == null ? '#64748b' : x.good ? '#15803d' : '#b91c1c') + '">' + esc(x.delta) + '</div></td></tr></table></td>';
                }).join('') + '</tr>';
            }
            h += '<tr><td style="padding:12px 24px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' + rowsH + '</table></td></tr>';
        }
        if (opts.keyLines !== false && model.keyLines.length) {
            var th2 = 'style="' + F + 'font-size:11px;color:#ffffff;background:' + th.a + ';padding:7px 8px;text-align:right"';
            h += '<tr><td style="padding:16px 30px 4px;' + F + 'font-size:15px;font-weight:bold;color:' + th.a + '">Income statement at a glance <span style="font-size:11px;color:#64748b;font-weight:normal">(' + esc(model.scaleLabel) + ')</span></td></tr>' +
                '<tr><td style="padding:4px 30px 8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><th ' + th2.replace('right', 'left') + '>&nbsp;</th><th ' + th2 + '>Month</th><th ' + th2 + '>YTD</th><th ' + th2 + '>YTD budget</th><th ' + th2 + '>YTD last year</th></tr>' +
                model.keyLines.map(function (r, k) {
                    var td = 'style="' + F + 'font-size:12px;padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;color:#0f172a;' + (r.bold ? 'font-weight:bold;' : '') + (k % 2 ? 'background:#f8fafc;' : '') + '"';
                    return '<tr><td ' + td.replace('text-align:right', 'text-align:left') + '>' + esc(r.label) + '</td><td ' + td + '>' + n(r.m) + '</td><td ' + td + '>' + n(r.y) + '</td><td ' + td + '>' + n(r.yb) + '</td><td ' + td + '>' + n(r.py) + '</td></tr>';
                }).join('') + '</table></td></tr>';
        }
        if (opts.chart) h += '<tr><td style="padding:12px 30px 4px;' + F + 'font-size:15px;font-weight:bold;color:' + th.a + '">Revenue and net profit, last 12 months</td></tr><tr><td style="padding:4px 30px 8px"><img src="' + opts.chart + '" width="580" style="width:580px;max-width:100%;height:auto;border:0;display:block" alt="Revenue and net profit"></td></tr>';
        var hl = (opts.highlights !== false ? model.highlights : []).concat(model.attention.map(function (a) { return '⚠ ' + a; }));
        if (hl.length) h += '<tr><td style="padding:12px 30px 4px;' + F + 'font-size:15px;font-weight:bold;color:' + th.a + '">Highlights</td></tr><tr><td style="padding:2px 30px 8px;' + F + 'font-size:13px;line-height:1.55;color:#1e293b"><ul style="margin:0;padding-left:18px">' + hl.slice(0, 8).map(function (x) { return '<li style="margin:3px 0">' + esc(x) + '</li>'; }).join('') + '</ul></td></tr>';
        if (opts.attached) h += '<tr><td style="padding:14px 30px 8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9;border-radius:8px"><tr><td style="padding:12px 16px;' + F + 'font-size:13px;color:#0f172a">' +
            '&#128206; <b>The full interactive pack is attached:</b> ' + esc(opts.attached) + '<br><span style="color:#64748b">Open it in any browser — the menu on the left shows the ' + esc((opts.sections || []).join(', ')) + '. Lines open into accounts, every table has search and CSV, and Print gives the whole pack.</span></td></tr></table></td></tr>';
        h += '<tr><td style="padding:18px 30px 24px;' + F + 'font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0">' + esc(pack.company || '') + ' &middot; ' + esc(pack.title || pack.name) + ' &middot; ' + esc(model.period) + ' &middot; prepared with Finance Lens from the general ledger</td></tr>' +
            '</table></td></tr></table></body></html>';
        return { html: h, subject: fill((pack.email || {}).subject || '{TITLE} · {PERIOD}') };
    };
})();
