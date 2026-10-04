/* Finance Lens — Segment P&L (tab `segpl`): the P&L — and a trial balance — by the extended segments synced in Data › Trial balance
   sync › Extended segments (DuckDB view fin_gl_ext_v). Left panel: ledger, periods (several), companies, the segments to group by in
   order (e.g. Salesperson ▸ Profit centre; company and account are always in the data), value filters per segment, the statement
   template and its lines. Centre: Tree (one row per segment value, children per next segment, the chosen P&L lines as columns — every
   node is the real template computed by FINE.compute on that node's accounts), By columns (the whole statement with one column per
   value of the first segment), Pivot (rows / columns / measure, subtotals, collapsible) and Trial balance (opening, debits, credits,
   closing per company × account × segments). Selected periods are added up (movement); closing = opening of the first + movement. */
(function () {
    var G = FL.segpl = { st: Object.assign({ ledger: null, periods: [], cos: [], groups: [], filters: {}, view: 'tree', cmp: 'none', colBy: 'seg', tpl: null, lines: null, pv: { rows: [], col: 'period', measure: 'profit' }, open: {} }, FL.ls('segpl', {})) };
    var save = function () { var s = Object.assign({}, G.st); delete s.open; FL.lsSet('segpl', s); };
    var BASE = { company: 'Company', account: 'Account', period: 'Period' };
    var money = function (v) { var d = G.st.dec; return v == null ? '' : FINE.fmt(v / (FL.filter.scale || 1), 'num', { decimals: d != null && d !== '' ? +d : FL.filter.scale >= 1000000 ? 1 : 0 }); };
    var segCol = function (c) { return /^segment([1-9]|[12][0-9]|30)$/.test(c); };
    // value groups: "grp_segmentN" is a field made of the user's groups of that segment's values (config.json segGroups[coa|col])
    var isGrp = G.isGrp = function (f) { return /^grp_segment([1-9]|[12][0-9]|30)$/.test(f || ''); };
    G.grpBase = function (f) { return isGrp(f) ? f.slice(4) : f; };
    G.grpKey = function (col) { return String((G.led || {}).coa_id || '') + '|' + col; };
    G.grpDef = function (col) { var d = ((FL.config || {}).segGroups || {})[G.grpKey(col)]; return d && d.groups && d.groups.length ? d : null; };
    G.NOGRP = '(not grouped)';
    /** Writes each row's group into r.grp_segmentN for every grouping in use */
    G.decorate = function () {
        var used = {}; (G.st.groups || []).concat(G.st.pv.rows || [], [G.st.pv.col]).forEach(function (f) { if (isGrp(f)) used[f] = 1; });
        Object.keys(used).forEach(function (f) {
            var col = G.grpBase(f), d = G.grpDef(col), m = {};
            if (d) d.groups.forEach(function (g) { (g.values || []).forEach(function (v) { m[v] = g.name; }); });
            (G.rows || []).concat(G.cmpRows || []).forEach(function (r) { var v = r[col] == null ? '' : String(r[col]); r[f] = m[v] || G.NOGRP; });
        });
    };

    G.money = money;
    // Segment P&L and the AI Agent page share this engine (left panel, data); the AI Agent is its own page in the menu (tab segai)
    G.mode = 'segpl';
    FL.TABS.segpl = { render: function (el) { G.mode = 'segpl'; if (G.st.view === 'ai') G.st.view = 'kpi'; return G.render(el); } };
    FL.TABS.segai = { render: function (el) { G.mode = 'agent'; return G.render(el); } };

    // ── what is on this PC: ledgers, periods, segments, names ──
    G.meta = function () {
        return FL.rows("SELECT e.ledger_id, ANY_VALUE(l.name) AS name, ANY_VALUE(l.currency) AS currency, ANY_VALUE(l.coa_id) AS coa_id, ANY_VALUE(l.company_segment) AS cseg, ANY_VALUE(l.account_segment) AS aseg, ANY_VALUE(e.pod) AS pod, COUNT(*) AS n " +
            "FROM fin_gl_ext_v e LEFT JOIN fin_tb_ledgers l ON l.ledger_id = e.ledger_id AND l.pod = e.pod GROUP BY 1 ORDER BY 2", 100).then(function (leds) {
            G.leds = leds;
            if (!leds.length) return null;
            if (!leds.some(function (l) { return String(l.ledger_id) === String(G.st.ledger); })) G.st.ledger = leds[0].ledger_id;
            var L = G.led = leds.filter(function (l) { return String(l.ledger_id) === String(G.st.ledger); })[0], w = ' WHERE ledger_id = ' + (+L.ledger_id);
            return Promise.all([
                FL.rows("SELECT period_seq, MIN(CASE WHEN NOT adj THEN period_name END) AS name, string_agg(DISTINCT CASE WHEN adj THEN period_name END, ', ') AS adjs FROM fin_gl_ext_v" + w + " AND period_seq IS NOT NULL GROUP BY 1 ORDER BY 1", 1000),
                FL.rows("SELECT DISTINCT segments FROM fin_gl_balances_ext_sync" + w, 1000),
                FL.rows("SELECT DISTINCT company FROM fin_gl_ext_v" + w + " ORDER BY 1", 5000),
                FL.rows("SELECT column_name, ANY_VALUE(segment_name) AS name FROM fin_coa_segments WHERE coa_id = " + FL.q(L.coa_id || '') + " GROUP BY 1", 100).catch(function () { return []; })
            ]).then(function (r) {
                G.periods = r[0].map(function (p) { return { seq: +p.period_seq, name: p.name || String(p.period_seq), adjs: p.adjs }; });
                var cols = {}; r[1].forEach(function (x) { String(x.segments || '').split(',').forEach(function (c) { if (c) cols[c.toLowerCase()] = 1; }); });
                var cseg = String(L.cseg || '').toLowerCase(), aseg = String(L.aseg || '').toLowerCase();
                G.segs = Object.keys(cols).filter(function (c) { return segCol(c) && c !== cseg && c !== aseg; }).sort(function (a, b) { return +a.slice(7) - +b.slice(7); });
                G.cos = r[2].map(function (x) { return x.company; });
                G.segName = {}; r[3].forEach(function (x) { if (x.name) G.segName[String(x.column_name).toLowerCase()] = x.name; });
                G.st.groups = (G.st.groups || []).filter(function (g) { return G.segs.indexOf(g) >= 0 || g === 'company' || (isGrp(g) && G.segs.indexOf(G.grpBase(g)) >= 0 && G.grpDef(G.grpBase(g))); });
                var seqs = G.periods.map(function (p) { return p.seq; });
                G.st.periods = (G.st.periods || []).filter(function (q) { return seqs.indexOf(q) >= 0; });
                if (!G.st.periods.length && seqs.length) G.st.periods = [seqs[seqs.length - 1]];
                return FL.rows("SELECT lower(column_name) AS col, value, ANY_VALUE(description) AS d FROM fin_segment_values WHERE coa_id = " + FL.q(L.coa_id || '') +
                    " AND lower(column_name) IN (" + (G.segs.length ? G.segs.map(FL.q).join(',') : "''") + ") GROUP BY 1, 2", 200000).catch(function () { return []; });
            }).then(function (vals) {
                G.vals0 = vals;
                // segment names this PC's DuckDB does not hold (fin_coa_segments is filled by full loads only): the saved discovery
                if (!G.segs.some(function (c) { return !G.segName[c]; }) || !FL.fusion || !FL.fusion.getDisc) return vals;
                return FL.fusion.getDisc(L.pod || '').then(function (r) {
                    var c = r && r.disc && (r.disc.coas || {})[String(L.coa_id)];
                    (c && c.segments || []).forEach(function (x) { var k = String(x.col || '').toLowerCase(); if (k && x.name && !G.segName[k]) G.segName[k] = x.name; });
                    return vals;
                }).catch(function () { return vals; });
            }).then(function (vals) {
                G.valName = {}; (vals || []).forEach(function (v) { (G.valName[v.col] = G.valName[v.col] || {})[v.value] = v.d; });
                return true;
            });
        }).catch(function () { return null; });
    };
    G.label = function (f) { if (isGrp(f)) { var gd = G.grpDef(G.grpBase(f)); return (gd && gd.name) || G.label(G.grpBase(f)) + ' group'; } return BASE[f] || (G.segName[f] ? G.segName[f] : f.toUpperCase()) ; };
    G.valLabel = function (f, v) {
        if (v == null || v === '') return '(blank)';
        if (isGrp(f)) return String(v);
        if (f === 'company') { var c = (FL.dims.companies || []).filter(function (x) { return x.code === v; })[0]; return v + (c && c.name && c.name !== v ? ' · ' + c.name : ''); }
        if (f === 'account') { var a = G.accBy[v]; return v + (a && a.name && a.name !== v ? ' · ' + a.name : ''); }
        if (f === 'period') { var p = G.periods.filter(function (x) { return x.seq === +v; })[0]; return p ? p.name : v; }
        var d = (G.valName[f] || {})[v]; return v + (d && d !== v ? ' · ' + d : '');
    };
    G.tpls = function () { return (FL.stmt && FL.stmt.ofKind ? FL.stmt.ofKind('PL') : FL.templates.filter(function (t) { return t.type === 'PL'; })); };
    G.tplObj = function () { var t = G.tpls(); return t.filter(function (x) { return x.id === G.st.tpl; })[0] || t[0]; };

    // ── data: one query for everything the views need ──
    G.fields = function () {
        var f = (G.st.groups || []).map(G.grpBase);
        (G.st.pv.rows || []).concat([G.st.pv.col]).forEach(function (x) { x = G.grpBase(x); if (x && segCol(x) && f.indexOf(x) < 0) f.push(x); });
        return f.filter(function (x, i) { return segCol(x) && f.indexOf(x) === i; });
    };
    /** The comparison period of each chosen period: same period last year (seq − 100) or the block of periods just before the first
     *  chosen one (previous). → { map: {chosen: cmp}, seqs: [cmp synced], missing: [cmp not on this PC] } */
    G.cmpPlan = function () {
        var s = G.st, ps = s.periods.slice().sort(), have = G.periods.map(function (p) { return p.seq; }), map = {};
        if (s.cmp === 'py') ps.forEach(function (q) { map[q] = q - 100; });
        else if (s.cmp === 'prev') {
            var i0 = have.indexOf(ps[0]), n = ps.length;
            ps.forEach(function (q, k) { var j = i0 - n + k; map[q] = j >= 0 ? have[j] : (Math.floor(q / 100) * 12 + q % 100 - 1 - n >= 0 ? (function (m) { return Math.floor(m / 12) * 100 + m % 12 + 1; })(Math.floor(q / 100) * 12 + q % 100 - 1 - n) : null); });
        }
        var seqs = [], missing = [];
        Object.keys(map).forEach(function (k) { var c = map[k]; if (c == null) return; if (have.indexOf(c) >= 0) { if (seqs.indexOf(c) < 0) seqs.push(c); } else if (missing.indexOf(c) < 0) missing.push(c); });
        return { map: map, seqs: seqs.sort(), missing: missing.sort() };
    };
    G.pname = function (q) { var p = G.periods.filter(function (x) { return x.seq === +q; })[0]; if (p) return p.name; var m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][(q % 100) - 1]; return m ? m + '-' + String(Math.floor(q / 100)).slice(2) : String(q); };
    G.load = function () {
        var L = G.led, ps = G.st.periods.slice().sort(), first = ps[0], fs = G.fields(), plan = G.plan = G.cmpPlan();
        var all = ps.concat(plan.seqs.filter(function (q) { return ps.indexOf(q) < 0; }));
        var firsts = [first].concat(plan.seqs.length ? [plan.seqs[0]] : []);
        var w = ['ledger_id = ' + (+L.ledger_id), 'period_seq IN (' + all.join(',') + ')'];
        if (G.st.cos.length) w.push('company IN (' + G.st.cos.map(FL.q).join(',') + ')');
        Object.keys(G.st.filters || {}).forEach(function (c) { var v = G.st.filters[c]; if (segCol(c) && v && v.length) w.push('COALESCE(' + c + ", '') IN (" + v.map(FL.q).join(',') + ')'); });
        var sql = 'SELECT period_seq, company, account' + fs.map(function (c) { return ', ' + c; }).join('') +
            ', SUM(dr - cr) AS net, SUM(dr) AS dr, SUM(cr) AS cr, SUM(CASE WHEN period_seq IN (' + firsts.join(',') + ') AND NOT adj THEN opening ELSE 0 END) AS opening, SUM(CASE WHEN NOT adj THEN opening ELSE 0 END) AS opening_p FROM fin_gl_ext_v WHERE ' + w.join(' AND ') + ' GROUP BY ALL';
        G.sqlText = sql;
        return FL.sql(sql, 400000).then(function (d) {
            G.truncated = d.truncated;
            var rows = d.rows.map(function (r) { var o = {}; d.columns.forEach(function (c, i) { o[c] = r[i]; }); o.period_seq = +o.period_seq; o.period = String(o.period_seq); o.net = +o.net || 0; o.dr = +o.dr || 0; o.cr = +o.cr || 0; o.opening = +o.opening || 0; o.opening_p = +o.opening_p || 0; return o; });
            // the chosen periods drive every view; the comparison periods only feed the comparison columns
            var keep = function (list, f) { return rows.filter(function (r) { return list.indexOf(r.period_seq) >= 0; }).map(function (r) { return r.period_seq === f ? r : Object.assign({}, r, { opening: 0 }); }); };
            G.rows = keep(ps, first);
            G.cmpRows = keep(plan.seqs, plan.seqs[0]);
            G.decorate();
        });
    };

    // ── the statement of a set of rows: the template computed on those rows' accounts (all chosen periods as one) ──
    G.prep = function () {
        G.accBy = {}; (FL.dims.accounts || []).forEach(function (a) { G.accBy[a.code] = a; });
        var accs = (FL.dims.accounts || []).slice(), seen = {};
        accs.forEach(function (a) { seen[a.code] = 1; });
        (G.rows || []).concat(G.cmpRows || []).forEach(function (r) { if (!seen[r.account]) { seen[r.account] = 1; var a = { code: r.account, name: r.account, account_type: FINE.guessType ? FINE.guessType({ code: r.account, name: '' }) : 'E' }; accs.push(a); G.accBy[a.code] = a; } });
        G.lastSeq = Math.max.apply(null, G.st.periods);
        var pl = (FL.dims.periods || []).filter(function (p) { return p.period_seq === G.lastSeq; })[0];
        G.data0 = { accounts: accs, periods: pl ? [pl] : [{ period_seq: G.lastSeq, period_name: String(G.lastSeq), fiscal_year: Math.floor(G.lastSeq / 100), period_num: G.lastSeq % 100, quarter: Math.ceil((G.lastSeq % 100) / 3) }] };
    };
    G.stmt = function (rows) {
        var acc = {};
        rows.forEach(function (r) { var a = acc[r.account] = acc[r.account] || [0, 0]; a[0] += r.net; a[1] += r.opening + r.net; });
        var f = {}; Object.keys(acc).forEach(function (k) { f[k] = {}; f[k][G.lastSeq] = acc[k]; });
        var data = { accounts: G.data0.accounts, periods: G.data0.periods, facts: { ACTUAL: f } };
        return FINE.compute(G.tplObj(), data, { period: G.lastSeq, scale: 1, columns: [{ id: 'v', scenario: 'ACTUAL', range: 'MTD' }] });
    };
    G.lineRows = function (st) { return st.rows.filter(function (r) { return r.id && !r.hidden && r.type !== 'header' && r.type !== 'blank' && r.type !== 'text'; }); };
    G.defLines = function (st) {
        var rows = G.lineRows(st), pref = ['REV', 'COGS', 'GP', 'GPM', 'OPEX', 'EBITDA', 'EBIT', 'NP', 'NET'];
        var pick = pref.filter(function (id) { return rows.some(function (r) { return r.id === id; }); });
        if (pick.length < 3) pick = rows.filter(function (r) { return r.type === 'group' || r.type === 'formula' || (r.level || 0) === 0; }).slice(0, 6).map(function (r) { return r.id; });
        return pick.slice(0, 7);
    };
    G.fmtLine = function (r, v) { return v == null ? '' : /^(pct|ratio|days)$/.test(r.format) ? FINE.fmt(v, r.format) : money(v); };

    // ── page ──
    G.render = function (el) {
        el.innerHTML = '<div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i> Reading the extended segments on this PC…</div>';
        return G.meta().then(function (ok) {
            if (!ok) {
                el.innerHTML = '<div class="card" style="max-width:820px"><h2 style="margin-top:0"><i class="fa-solid fa-layer-group"></i> Segment P&amp;L</h2><p>The P&amp;L and the trial balance by salesperson, profit centre, cost centre, analysis … need the <b>extended segments</b> on this PC.</p>' +
                    '<ol><li>Data › Trial balance sync › Settings › <b>Extended segments</b>: tick the segments (e.g. Salesperson, Item profit centre) and <b>Save choice</b>.</li><li>Press <b>Sync extended</b> (or tick "sync them after every trial balance sync").</li><li>Come back here.</li></ol>' +
                    '<button class="btn primary" id="sp-go"><i class="fa-solid fa-arrow-right"></i> Open Trial balance sync</button></div>';
                $('sp-go').onclick = function () { FL.show('data'); setTimeout(function () { if (FL.dataTab) FL.dataTab.go('tbsync'); }, 50); };
                return;
            }
            el.innerHTML = '<div class="sp-wrap"><aside class="sp-side card" id="sp-side"></aside><section class="sp-main"><div class="sp-bar" id="sp-bar"></div><div id="sp-out"><div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i></div></div></section></div>';
            G.side();
            return G.run();
        });
    };
    G.side = function () {
        var s = G.st, L = G.led, box = $('sp-side');
        var years = {}; G.periods.forEach(function (p) { (years[Math.floor(p.seq / 100)] = years[Math.floor(p.seq / 100)] || []).push(p); });
        var avail = G.segs.filter(function (c) { return s.groups.indexOf(c) < 0; }).concat(s.groups.indexOf('company') < 0 ? ['company'] : [])
            .concat(G.segs.filter(function (c) { return G.grpDef(c) && s.groups.indexOf('grp_' + c) < 0; }).map(function (c) { return 'grp_' + c; }));
        box.innerHTML =
            '<div class="sp-sec"><label class="sm"><b>Ledger</b></label><select id="sp-led">' + G.leds.map(function (l) { return '<option value="' + l.ledger_id + '"' + (String(l.ledger_id) === String(s.ledger) ? ' selected' : '') + '>' + esc((l.name || l.ledger_id) + (l.currency ? ' · ' + l.currency : '')) + '</option>'; }).join('') + '</select></div>' +
            '<div class="sp-sec"><div class="row"><b class="sm">Periods</b><span class="grow"></span><span class="sm muted">' + s.periods.length + ' chosen</span></div>' +
            '<div class="sp-quick">' + [['last', 'Last'], ['q', 'Quarter'], ['ytd', 'YTD'], ['12', '12 m'], ['all', 'All']].map(function (x) { return '<button class="btn sm ghost" data-q="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>' +
            '<div class="sp-per">' + Object.keys(years).sort().reverse().map(function (y) {
                return '<div class="sp-year"><a data-y="' + y + '">' + y + '</a></div><div class="sp-pchips">' + years[y].map(function (p) {
                    return '<label class="chip' + (s.periods.indexOf(p.seq) >= 0 ? ' on' : '') + '" title="' + esc(p.adjs ? 'includes ' + p.adjs : '') + '"><input type="checkbox" data-p="' + p.seq + '"' + (s.periods.indexOf(p.seq) >= 0 ? ' checked' : '') + '>' + esc(p.name.replace(/-\d{2,4}$/, '')) + '</label>';
                }).join('') + '</div>';
            }).join('') + '</div></div>' +
            '<div class="sp-sec"><div class="row"><b class="sm">Group by</b><span class="grow"></span><span class="sm muted">company &amp; account always in</span></div>' +
            '<div id="sp-groups" class="sp-groups">' + (s.groups.length ? s.groups.map(function (g, i) {
                var nf = (s.filters[g] || []).length;
                return '<div class="sp-g"><span class="sp-gi">' + (i + 1) + '</span><b>' + esc(G.label(g)) + '</b><span class="grow"></span>' +
                    (segCol(G.grpBase(g)) ? '<a data-gr="' + G.grpBase(g) + '" title="Group the values of ' + esc(G.label(G.grpBase(g))) + ' (e.g. Door to door, Pre-sales, Shops)"' + (G.grpDef(G.grpBase(g)) ? ' class="on"' : '') + '>⧉</a>' : '') +
                    (isGrp(g) ? '' : '<a data-f="' + g + '" title="Filter values" class="' + (nf ? 'on' : '') + '"><i class="fa-solid fa-filter"></i>' + (nf ? ' ' + nf : '') + '</a>') +
                    '<a data-up="' + i + '" title="Up"' + (i ? '' : ' class="off"') + '>↑</a><a data-dn="' + i + '" title="Down"' + (i < s.groups.length - 1 ? '' : ' class="off"') + '>↓</a><a data-rm="' + i + '" title="Remove">×</a></div>';
            }).join('') : '<div class="sm muted">Nothing yet — add a segment to see the P&amp;L by it (e.g. Salesperson, then Profit centre under it).</div>') + '</div>' +
            (avail.length ? '<select id="sp-add"><option value="">+ add a segment…</option>' + avail.map(function (c) { return '<option value="' + c + '">' + esc(isGrp(c) ? '⧉ ' + G.label(c) + ' — groups of ' + G.label(G.grpBase(c)) : G.label(c) + (segCol(c) ? ' (' + c.toUpperCase() + ')' : '')) + '</option>'; }).join('') + '</select>' : '') +
            '<div class="sm" style="margin-top:4px"><a id="sp-grpnew"><i class="fa-solid fa-object-group"></i> Group the values of a segment…</a></div>' +
            (G.segs.filter(function (c) { return s.groups.indexOf(c) < 0 && (s.filters[c] || []).length; }).map(function (c) { return '<div class="sm">Filter on ' + esc(G.label(c)) + ': ' + s.filters[c].length + ' value(s) <a data-f="' + c + '">change</a></div>'; }).join('')) +
            '<div class="sm" style="margin-top:4px"><a id="sp-flt">Filter another segment…</a></div></div>' +
            '<div class="sp-sec"><div class="row"><b class="sm">Companies</b><span class="grow"></span><a class="sm" id="sp-coall">' + (s.cos.length ? 'all' : '') + '</a></div><div class="sp-cos">' + G.cos.map(function (c) {
                return '<label class="chip' + (s.cos.indexOf(c) >= 0 ? ' on' : '') + '"><input type="checkbox" data-co="' + esc(c) + '"' + (s.cos.indexOf(c) >= 0 ? ' checked' : '') + '>' + esc(c) + '</label>'; }).join('') + '</div>' + (s.cos.length ? '' : '<div class="sm muted">every company</div>') + '</div>' +
            '<div class="sp-sec"><b class="sm">Statement</b><select id="sp-tpl">' + G.tpls().map(function (t) { return '<option value="' + esc(t.id) + '"' + (G.tplObj() === t ? ' selected' : '') + '>' + esc(t.name || t.id) + '</option>'; }).join('') + '</select>' +
            '<div class="sm" style="margin-top:4px"><a id="sp-lines">Lines shown in the tree…</a></div></div>' +
            '<div class="sp-sec sm muted">Data: extended segments synced for ' + esc(L.name || L.ledger_id) + ' (Data › Trial balance sync). Periods chosen are added up (By columns › Columns: <i>one per period</i> shows them side by side; <i>Compare with</i> adds last year or the previous periods); closing = opening of the first + movement.</div>';
        var q = function (x) { return box.querySelector(x); }, rerun = function () { save(); G.side(); G.run(); };
        q('#sp-led').onchange = function () { s.ledger = this.value; s.periods = []; s.filters = {}; save(); FL.render(); };
        box.querySelectorAll('[data-p]').forEach(function (c) { c.onchange = function () { var v = +c.dataset.p, i = s.periods.indexOf(v); if (c.checked && i < 0) s.periods.push(v); if (!c.checked && i >= 0) s.periods.splice(i, 1); if (!s.periods.length) s.periods = [v]; rerun(); }; });
        box.querySelectorAll('[data-y]').forEach(function (a) { a.onclick = function () { s.periods = G.periods.filter(function (p) { return Math.floor(p.seq / 100) === +a.dataset.y; }).map(function (p) { return p.seq; }); rerun(); }; });
        box.querySelectorAll('[data-q]').forEach(function (b) {
            b.onclick = function () {
                var all = G.periods.map(function (p) { return p.seq; }), last = all[all.length - 1], k = b.dataset.q;
                s.periods = k === 'all' ? all : k === 'last' ? [last] : k === 'ytd' ? all.filter(function (x) { return Math.floor(x / 100) === Math.floor(last / 100) && x <= last; })
                    : k === '12' ? all.slice(-12) : all.filter(function (x) { return Math.floor(x / 100) === Math.floor(last / 100) && Math.ceil((x % 100) / 3) === Math.ceil((last % 100) / 3); });
                rerun();
            };
        });
        if (q('#sp-add')) q('#sp-add').onchange = function () {
            var v = this.value; if (!v) return;
            // a grouping goes in with its segment right under it, so the tree opens a group into its values
            if (isGrp(v)) { var b = G.grpBase(v), i = s.groups.indexOf(b); if (i >= 0) s.groups.splice(i, 0, v); else s.groups.push(v, b); } else s.groups.push(v);
            s.open = {}; rerun();
        };
        box.querySelectorAll('[data-gr]').forEach(function (a) { a.onclick = function () { if (G.groupEditor) G.groupEditor(a.dataset.gr); }; });
        q('#sp-grpnew').onclick = function () {
            if (G.segs.length === 1) return G.groupEditor(G.segs[0]);
            FL.modal('<i class="fa-solid fa-object-group"></i> Group the values of…', '<div class="sp-flist">' + G.segs.map(function (c) { return '<button class="btn sm" data-gc="' + c + '">' + esc(G.label(c)) + (G.grpDef(c) ? ' · ' + G.grpDef(c).groups.length + ' groups' : '') + '</button>'; }).join(' ') + '</div>');
            document.querySelectorAll('[data-gc]').forEach(function (b) { b.onclick = function () { G.groupEditor(b.dataset.gc); }; });
        };
        box.querySelectorAll('[data-up]').forEach(function (a) { a.onclick = function () { var i = +a.dataset.up; if (!i) return; s.groups.splice(i - 1, 0, s.groups.splice(i, 1)[0]); s.open = {}; rerun(); }; });
        box.querySelectorAll('[data-dn]').forEach(function (a) { a.onclick = function () { var i = +a.dataset.dn; if (i >= s.groups.length - 1) return; s.groups.splice(i + 1, 0, s.groups.splice(i, 1)[0]); s.open = {}; rerun(); }; });
        box.querySelectorAll('[data-rm]').forEach(function (a) { a.onclick = function () { s.groups.splice(+a.dataset.rm, 1); s.open = {}; rerun(); }; });
        box.querySelectorAll('[data-f]').forEach(function (a) { a.onclick = function () { G.filterPick(a.dataset.f); }; });
        q('#sp-flt').onclick = function () {
            FL.modal('<i class="fa-solid fa-filter"></i> Filter a segment', '<div class="sp-flist">' + G.segs.map(function (c) { return '<button class="btn sm" data-fc="' + c + '">' + esc(G.label(c)) + ((s.filters[c] || []).length ? ' · ' + s.filters[c].length : '') + '</button>'; }).join(' ') + '</div>');
            document.querySelectorAll('[data-fc]').forEach(function (b) { b.onclick = function () { G.filterPick(b.dataset.fc); }; });
        };
        box.querySelectorAll('[data-co]').forEach(function (c) { c.onchange = function () { var v = c.dataset.co, i = s.cos.indexOf(v); if (c.checked && i < 0) s.cos.push(v); if (!c.checked && i >= 0) s.cos.splice(i, 1); rerun(); }; });
        if (q('#sp-coall')) q('#sp-coall').onclick = function () { s.cos = []; rerun(); };
        q('#sp-tpl').onchange = function () { s.tpl = this.value; s.lines = null; rerun(); };
        q('#sp-lines').onclick = G.linePick;
    };
    /** Value picker for one segment: search, tick the values to keep (none ticked = every value) */
    G.filterPick = function (col) {
        var L = G.led;
        FL.modal('<i class="fa-solid fa-filter"></i> ' + esc(G.label(col)) + ' — keep only', '<div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i></div>');
        FL.rows('SELECT COALESCE(' + col + ", '') AS v, ROUND(SUM(dr - cr), 2) AS net FROM fin_gl_ext_v WHERE ledger_id = " + (+L.ledger_id) + ' AND period_seq IN (' + G.st.periods.join(',') + ') GROUP BY 1 ORDER BY ABS(SUM(dr - cr)) DESC', 20000).then(function (vals) {
            var cur = G.st.filters[col] || [];
            $('m-body').innerHTML = '<div class="row"><input id="fp-q" placeholder="Search value or name" style="flex:1"><a id="fp-all">tick all shown</a> · <a id="fp-none">clear</a></div><p class="sm muted">' + vals.length + ' values in the chosen periods · none ticked = every value</p>' +
                '<div class="scroll" style="max-height:55vh"><table class="t"><tbody>' + vals.map(function (v) {
                    return '<tr class="fp-r"><td><label><input type="checkbox" data-v="' + esc(v.v) + '"' + (cur.indexOf(v.v) >= 0 ? ' checked' : '') + '> ' + esc(G.valLabel(col, v.v)) + '</label></td><td class="n muted">' + money(v.net) + '</td></tr>'; }).join('') + '</tbody></table></div>';
            $('m-acts').innerHTML = '<button class="btn primary" id="fp-ok">Apply</button>';
            $('fp-q').oninput = function () { var t = this.value.toLowerCase(); document.querySelectorAll('.fp-r').forEach(function (tr) { tr.style.display = tr.textContent.toLowerCase().indexOf(t) >= 0 ? '' : 'none'; }); };
            $('fp-all').onclick = function () { document.querySelectorAll('.fp-r').forEach(function (tr) { if (tr.style.display !== 'none') tr.querySelector('input').checked = true; }); };
            $('fp-none').onclick = function () { document.querySelectorAll('.fp-r input').forEach(function (i) { i.checked = false; }); };
            $('fp-ok').onclick = function () { G.st.filters[col] = [].map.call(document.querySelectorAll('.fp-r input:checked'), function (i) { return i.dataset.v; }); if (!G.st.filters[col].length) delete G.st.filters[col]; FL.closeModal(); save(); G.side(); G.run(); };
        });
    };
    G.linePick = function () {
        if (!G.total) return;
        var rows = G.lineRows(G.total), cur = G.st.lines || G.defLines(G.total);
        FL.modal('<i class="fa-solid fa-list"></i> P&amp;L lines shown as columns', '<div class="scroll" style="max-height:60vh">' + rows.map(function (r) {
            return '<label style="display:block;padding:2px 0;padding-left:' + (r.level || 0) * 14 + 'px"><input type="checkbox" data-l="' + esc(r.id) + '"' + (cur.indexOf(r.id) >= 0 ? ' checked' : '') + '> ' + esc(r.label) + ' <span class="muted sm">' + esc(r.id) + '</span></label>'; }).join('') + '</div>',
            '<button class="btn" id="lp-def">Default</button><button class="btn primary" id="lp-ok">Apply</button>');
        $('lp-def').onclick = function () { G.st.lines = null; FL.closeModal(); save(); G.draw(); };
        $('lp-ok').onclick = function () { G.st.lines = [].map.call(document.querySelectorAll('[data-l]:checked'), function (i) { return i.dataset.l; }); if (!G.st.lines.length) G.st.lines = null; FL.closeModal(); save(); G.draw(); };
    };

    G.run = function () {
        var out = $('sp-out'); if (!out) return;
        out.innerHTML = '<div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i> Adding up ' + G.st.periods.length + ' period(s)…</div>';
        return G.load().then(function () { G.prep(); G.total = G.stmt(G.rows); G.draw(); }).catch(function (e) { out.innerHTML = '<div class="callout bad">' + esc(String(e && e.message || e)) + '</div>'; });
    };
    G.draw = function () {
        var s = G.st, bar = $('sp-bar'), out = $('sp-out'); if (!bar || !out) return;
        // charts of the view being replaced (KPIs) must go before their canvases do — Chart.js resize handlers fail on detached canvases
        Object.keys(FL.charts || {}).forEach(function (k) { if (/^sk-/.test(k)) { try { FL.charts[k].destroy(); } catch (e) { /* gone */ } delete FL.charts[k]; } });
        if (G.ai && G.ai.charts) { G.ai.charts.forEach(function (c) { try { c.destroy(); } catch (e) { /* gone */ } }); G.ai.charts = []; }
        var pn = s.periods.slice().sort().map(function (q) { return (G.periods.filter(function (p) { return p.seq === q; })[0] || {}).name || q; });
        var agent = G.mode === 'agent';
        if (!agent && s.view === 'ai') s.view = 'kpi';
        bar.innerHTML = '<div class="row"><h2 style="margin:0"><i class="fa-solid ' + (agent ? 'fa-robot' : 'fa-layer-group') + '"></i> ' + (agent ? 'AI Agent · ' : '') + esc(G.tplObj() ? G.tplObj().name : 'P&L') + (s.groups.length ? ' by ' + s.groups.map(G.label).map(esc).join(' ▸ ') : '') + '</h2><span class="grow"></span>' +
            (agent ? '<a class="sm" id="sp-toseg" style="margin-right:8px"><i class="fa-solid fa-layer-group"></i> Open in Segment P&amp;L</a>' : '<div class="seg" id="sp-view">' + [['kpi', 'KPIs'], ['tree', 'Tree'], ['cols', 'By columns'], ['pivot', 'Pivot'], ['tb', 'Trial balance']].map(function (v) { return '<button data-v="' + v[0] + '" class="' + (s.view === v[0] ? 'on' : '') + '">' + v[1] + '</button>'; }).join('') + '</div>') +
            '<label class="sm sp-units" title="Amounts shown in">Amounts <select id="sp-scale">' + [[1, 'absolute'], [100, 'hundreds'], [1000, 'thousands'], [1000000, 'millions']].map(function (o) { return '<option value="' + o[0] + '"' + (+FL.filter.scale === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
            '<select id="sp-dec" title="Decimals">' + [['', 'auto'], ['0', '0 dp'], ['1', '1 dp'], ['2', '2 dp']].map(function (o) { return '<option value="' + o[0] + '"' + (String(s.dec == null ? '' : s.dec) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
            '<button class="btn sm" id="sp-xl"><i class="fa-solid fa-file-excel"></i> Excel</button></div>' +
            '<div class="sm muted">' + esc(pn.length > 4 ? pn[0] + ' – ' + pn[pn.length - 1] + ' (' + pn.length + ' periods)' : pn.join(', ')) + ' · ' + (s.cos.length ? s.cos.length + ' compan' + (s.cos.length === 1 ? 'y' : 'ies') : 'every company') + ' · amounts in ' + FL.scaleLabel() +
            (s.cmp !== 'none' && G.plan ? ' · compared with ' + esc(s.cmp === 'py' ? 'the same period last year' : 'the previous period' + (s.periods.length > 1 ? 's' : '')) + ' (' + esc(G.plan.seqs.map(G.pname).join(', ') || 'none synced') + ')' : '') +
            ' · ' + G.rows.length.toLocaleString() + ' balance rows' + (G.truncated ? ' <b class="neg">(cut at 400,000 — narrow the periods or filters)</b>' : '') + '</div>';
        bar.querySelectorAll('#sp-view button').forEach(function (b) { b.onclick = function () { s.view = b.dataset.v; save(); G.draw(); }; });
        $('sp-xl').onclick = G.excel;
        if ($('sp-toseg')) $('sp-toseg').onclick = function () { FL.show('segpl'); };
        // amounts: the module-wide scale (kept in step with the header) and decimals for this page
        $('sp-scale').onchange = function () { FL.filter.scale = +this.value; if ($('f-scale')) $('f-scale').value = FL.filter.scale; FL.lsSet('filter', FL.filter); FL.cache = {}; G.draw(); };
        $('sp-dec').onchange = function () { s.dec = this.value === '' ? null : +this.value; save(); G.draw(); };
        G.out = null;
        if (agent && G.viewAi) { G.viewAi(out); if (G.pendingAi && G.ai) { var pa = G.pendingAi; G.pendingAi = null; setTimeout(function () { G.ai.run(pa); }, 50); } }
        else if (s.view === 'kpi' && G.viewKpi) G.viewKpi(out); else if (s.view === 'cols') G.viewCols(out); else if (s.view === 'pivot') G.viewPivot(out); else if (s.view === 'tb') G.viewTb(out); else G.viewTree(out);
    };

    // ── Tree: one row per value of the first segment, children per next segment, chosen lines as columns ──
    G.viewTree = function (out) {
        var s = G.st, lines = (s.lines || G.defLines(G.total)).map(function (id) { return G.total.rows.filter(function (r) { return r.id === id; })[0]; }).filter(Boolean);
        var groups = s.groups, html = [], flat = [], ps = s.periods.slice().sort(), plan = G.plan || { seqs: [], missing: [] };
        // period handling: the chosen periods added up (optionally compared with last year / the previous periods) or side by side
        // (optionally with the change between them and a total) — every value is still the template computed on that node's rows
        var mode = s.treeBy === 'period' && ps.length > 1 ? 'period' : 'sum', cmp = mode === 'sum' && s.cmp !== 'none';
        var tvar = s.tvar || 'prev', show = s.tvshow || 'both', showAbs = show !== 'pct', showPct = show !== 'abs', ttot = mode === 'period' && !!s.ttot, CL = s.cmp === 'py' ? 'PY' : 'Prev';
        var slots = [];
        if (mode === 'sum') {
            slots.push({ t: 'v', a: 0, label: cmp ? 'Actual' : '' });
            if (cmp) { slots.push({ t: 'v', a: 1, label: CL, cv: 1 }); if (showAbs) slots.push({ t: 'd', a: 0, b: 1, label: 'Δ' }); if (showPct) slots.push({ t: 'p', a: 0, b: 1, label: 'Δ %' }); }
        } else {
            ps.forEach(function (q, i) {
                slots.push({ t: 'v', a: i, label: G.pname(q) });
                if (tvar !== 'none' && i > 0) { var bi = tvar === 'first' ? 0 : i - 1;
                    if (showAbs) slots.push({ t: 'd', a: i, b: bi, label: 'Δ', title: G.pname(q) + ' − ' + G.pname(ps[bi]) });
                    if (showPct) slots.push({ t: 'p', a: i, b: bi, label: showAbs ? 'Δ %' : 'Δ % vs ' + G.pname(ps[bi]) }); }
            });
            if (ttot) slots.push({ t: 'v', a: ps.length, label: 'Total' });
        }
        var stats = function (rows, crows) {
            if (mode === 'sum') return cmp ? [G.stmt(rows), G.stmt(crows || [])] : [G.stmt(rows)];
            var st = ps.map(function (q) { return G.stmt(rows.filter(function (r) { return r.period_seq === q; })); });
            if (ttot) st.push(G.stmt(rows)); return st;
        };
        var lv = function (st, l) { var r = st.rows.filter(function (x) { return x.id === l.id; })[0]; return r ? r.values[0] : null; };
        var isPct = function (l) { return /^(pct|ratio|days)$/.test(l.format); };
        var calc = function (sts, l, sl) {
            if (sl.t === 'v') return lv(sts[sl.a], l);
            var v = lv(sts[sl.a], l), bv = lv(sts[sl.b], l); if (v == null && bv == null) return null;
            var d = (v || 0) - (bv || 0); return sl.t === 'd' ? d : isPct(l) || !bv ? null : d / Math.abs(bv) * 100;
        };
        var cell = function (sts, l, sl, bold) {
            var v = calc(sts, l, sl), cls = 'n' + (sl.cv ? ' sp-cv' : '') + (sl.t !== 'v' ? ' sp-vd' : '');
            if (sl.t !== 'v' && v != null && Math.abs(v) >= 0.005) cls += (l.favourable === 'down' ? v < 0 : v > 0) ? ' pos' : ' neg';
            else if (sl.t === 'v' && v < 0 && !isPct(l)) cls += ' neg';
            var txt = v == null ? '' : sl.t === 'p' ? (v > 0 ? '+' : '') + v.toFixed(1) + '%' : sl.t === 'd' ? (isPct(l) ? (v > 0 ? '+' : '') + v.toFixed(1) + ' pts' : (v > 0 ? '+' : '') + money(v)) : G.fmtLine(l, v);
            return '<td class="' + cls + '">' + (bold ? '<b>' + txt + '</b>' : txt) + '</td>';
        };
        var xv = function (sts) { var sc = FL.filter.scale || 1, o = []; lines.forEach(function (l) { slots.forEach(function (sl) { var v = calc(sts, l, sl); o.push(v == null ? null : sl.t === 'p' || isPct(l) ? Math.round(v * 10) / 10 : v / sc); }); }); return o; };
        var keyOf = function (r, f) { var v = f === 'company' ? r.company : r[f]; return v == null ? '' : String(v); };
        var node = function (rows, crows, depth, path) {
            var f = groups[depth], by = {}, cby = {};
            rows.forEach(function (r) { var v = keyOf(r, f); (by[v] = by[v] || []).push(r); });
            (crows || []).forEach(function (r) { var v = keyOf(r, f); (cby[v] = cby[v] || []).push(r); });
            if (cmp) Object.keys(cby).forEach(function (v) { if (!by[v]) by[v] = []; });   // a value that only had amounts in the comparison period
            var kids = Object.keys(by).map(function (v) { var sts = stats(by[v], cby[v]); return { v: v, rows: by[v], crows: cby[v] || [], sts: sts, k: Math.abs(calc(sts, lines[0], slots[0]) || 0),
                    any: lines.some(function (l) { return slots.some(function (sl) { if (sl.t !== 'v') return false; var x = calc(sts, l, sl); return x != null && Math.abs(x) >= 0.005; }); }) }; })
                .filter(function (k) { return k.any; });   // a value with no P&L (e.g. balance-sheet only) is left out
            kids.sort(function (a, b) { return b.k - a.k; });
            kids.forEach(function (k) {
                var p = path.concat([k.v]), key = p.join('\u0001'), hasKids = depth < groups.length - 1, open = !!s.open[key];
                html.push('<tr class="sp-n d' + depth + '" data-k="' + esc(key) + '"><td style="padding-left:' + (8 + depth * 18) + 'px">' + (hasKids ? '<a class="sp-tg">' + (open ? '▾' : '▸') + '</a> ' : '<span class="sp-tg0"></span>') +
                    '<span title="' + esc(G.label(f)) + '">' + esc(G.valLabel(f, k.v)) + '</span> <a class="sp-full" title="The whole statement for this">⋯</a></td>' +
                    lines.map(function (l) { return slots.map(function (sl) { return cell(k.sts, l, sl); }).join(''); }).join('') + '</tr>');
                flat.push([new Array(depth + 1).join('   ') + G.valLabel(f, k.v)].concat(xv(k.sts)));
                G.nodes[key] = { rows: k.rows, label: p.map(function (x, i) { return G.label(groups[i]) + ' ' + G.valLabel(groups[i], x); }).join(' ▸ ') };
                if (hasKids && open) node(k.rows, k.crows, depth + 1, p);
            });
        };
        G.nodes = {};
        var tsts = stats(G.rows, G.cmpRows);
        if (groups.length) node(G.rows, cmp ? G.cmpRows : [], 0, []);
        var multi = slots.length > 1, first = groups.length ? esc(groups.map(G.label).join(' ▸ ')) : 'Total';
        var head = multi
            ? '<tr><th rowspan="2">' + first + '</th>' + lines.map(function (l) { return '<th class="sp-gh" colspan="' + slots.length + '">' + esc(l.label) + '</th>'; }).join('') + '</tr><tr>' +
              lines.map(function () { return slots.map(function (sl, i) { return '<th class="n' + (i === 0 ? ' sp-c0' : '') + (sl.cv ? ' sp-cv' : '') + (sl.t !== 'v' ? ' sp-vd' : '') + '"' + (sl.title ? ' title="' + esc(sl.title) + '"' : '') + '>' + esc(sl.label) + '</th>'; }).join(''); }).join('') + '</tr>'
            : '<tr><th>' + first + '</th>' + lines.map(function (l) { return '<th class="n">' + esc(l.label) + '</th>'; }).join('') + '</tr>';
        var sel = function (id, v, opts) { return '<select id="' + id + '">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (v === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>'; };
        var ctl = '<div class="row sm sp-cctl" style="margin-bottom:6px;flex-wrap:wrap;gap:10px">' +
            (ps.length > 1 ? '<label>Periods ' + sel('sp-tby', mode, [['sum', 'added up'], ['period', 'side by side']]) + '</label>' : '') +
            (mode === 'sum' ? '<label>Compare with ' + sel('sp-tcmp', s.cmp, [['none', 'nothing'], ['py', 'same period last year'], ['prev', 'previous period' + (ps.length > 1 ? 's' : '')]]) + '</label>'
                : '<label>Variance ' + sel('sp-tvar', tvar, [['none', 'none'], ['prev', 'vs previous period'], ['first', 'vs first period']]) + '</label>' +
                  '<label><input type="checkbox" id="sp-ttot"' + (ttot ? ' checked' : '') + '> Total column</label>') +
            ((mode === 'sum' && cmp) || (mode === 'period' && tvar !== 'none') ? '<label>Show ' + sel('sp-tshow', show, [['both', 'Δ and Δ %'], ['abs', 'Δ only'], ['pct', 'Δ % only']]) + '</label>' : '') + '</div>' +
            (cmp && plan.missing.length ? '<div class="callout warn sm" style="margin-bottom:6px"><b>' + esc(plan.missing.map(G.pname).join(', ')) + '</b> ' + (plan.missing.length === 1 ? 'is' : 'are') + ' not on this PC with the extended segments, so the comparison shows as blank. <a id="sp-gosync2">Sync in Data › Trial balance sync</a>.</div>' : '');
        out.innerHTML = '<div class="card sp-card">' + ctl + '<div class="scroll" style="max-height:72vh"><table class="t sp-tree' + (multi ? ' sp-cmp' : '') + '"><thead>' + head + '</thead><tbody>' +
            '<tr class="sp-total"><td><b>Total</b> <a class="sp-full" data-total="1" title="The whole statement">⋯</a></td>' + lines.map(function (l) { return slots.map(function (sl) { return cell(tsts, l, sl, true); }).join(''); }).join('') + '</tr>' + html.join('') + '</tbody></table></div>' +
            (groups.length ? '' : '<p class="sm muted">Add a segment on the left (e.g. Salesperson) to split the P&amp;L by it; add a second one (e.g. Profit centre) to open each value into the next.</p>') +
            '<p class="sm muted">Click ▸ to open the next segment · ⋯ = the whole statement for that row · columns: <a id="sp-lines2">choose the lines</a></p></div>';
        G.out = { head: [first.replace(/&[a-z]+;/g, '')].concat([].concat.apply([], lines.map(function (l) { return slots.map(function (sl) { return multi ? l.label + ' · ' + (sl.title || sl.label) : l.label; }); }))), rows: [['Total'].concat(xv(tsts))].concat(flat) };
        if ($('sp-tby')) $('sp-tby').onchange = function () { s.treeBy = this.value; save(); G.draw(); };
        if ($('sp-tcmp')) $('sp-tcmp').onchange = function () { s.cmp = this.value; save(); G.run(); };
        if ($('sp-tvar')) $('sp-tvar').onchange = function () { s.tvar = this.value; save(); G.draw(); };
        if ($('sp-ttot')) $('sp-ttot').onchange = function () { s.ttot = this.checked; save(); G.draw(); };
        if ($('sp-tshow')) $('sp-tshow').onchange = function () { s.tvshow = this.value; save(); G.draw(); };
        if ($('sp-gosync2')) $('sp-gosync2').onclick = function () { FL.show('data'); setTimeout(function () { if (FL.dataTab) FL.dataTab.go('tbsync'); }, 50); };
        out.querySelectorAll('.sp-tg').forEach(function (a) { a.onclick = function () { var k = a.closest('tr').dataset.k; if (s.open[k]) delete s.open[k]; else s.open[k] = 1; G.draw(); }; });
        out.querySelectorAll('.sp-full').forEach(function (a) { a.onclick = function () { var t = a.dataset.total, n = t ? { rows: G.rows, label: 'Total' } : G.nodes[a.closest('tr').dataset.k]; G.full(n); }; });
        if ($('sp-lines2')) $('sp-lines2').onclick = G.linePick;
    };
    /** The whole statement for one node */
    G.full = function (n) {
        var st = G.stmt(n.rows);
        FL.modal('<i class="fa-solid fa-file-invoice-dollar"></i> ' + esc(n.label), '<div class="scroll" style="max-height:66vh"><table class="t">' + st.rows.filter(function (r) { return !r.hidden && r.type !== 'blank'; }).map(function (r) {
            var v = r.values[0], b = r.type === 'group' || r.type === 'formula' || (r.style && r.style.bold);
            return '<tr class="' + (r.type === 'header' ? 'sp-h' : '') + '"><td style="padding-left:' + (8 + (r.level || 0) * 14) + 'px">' + (b ? '<b>' + esc(r.label) + '</b>' : esc(r.label)) + '</td><td class="n">' + (r.type === 'header' ? '' : (b ? '<b>' : '') + G.fmtLine(r, v) + (b ? '</b>' : '')) + '</td></tr>';
        }).join('') + '</table></div>');
    };

    // ── By columns: the whole statement, one column per value of the first segment (biggest 12 + others + total).
    //    A line with accounts opens (▸) into its accounts, each with its value per column; a click on an account cell lists the
    //    balance rows behind it (company × segments × period). ──
    G.cOpen = G.cOpen || {};
    G.viewCols = function (out) {
        var s = G.st, f = s.groups[0], key = (s.lines || G.defLines(G.total))[0], plan = G.plan || { map: {}, seqs: [], missing: [] };
        var cmp = s.cmp !== 'none', byPer = s.colBy === 'period' || !f;
        var cmpAll = G.cmpRows || [], valOf = function (r) { var v = f === 'company' ? r.company : r[f]; return v == null ? '' : String(v); };
        var cols;
        if (byPer) {
            // one column per chosen period (+ total); each compared with its own period last year / the period before
            var ps = s.periods.slice().sort();
            cols = ps.map(function (q) { var rr = G.rows.filter(function (r) { return r.period_seq === q; }), cq = plan.map[q];
                return { label: G.pname(q), rows: rr, crows: cmp ? cmpAll.filter(function (r) { return r.period_seq === cq; }) : [], clabel: cq ? G.pname(cq) : '–' }; });
            if (ps.length > 1) cols.push({ label: 'Total', rows: G.rows, crows: cmpAll, clabel: plan.seqs.length ? G.pname(plan.seqs[0]) + (plan.seqs.length > 1 ? ' – ' + G.pname(plan.seqs[plan.seqs.length - 1]) : '') : '–', total: true });
        } else {
            var by = {}, cby = {};
            G.rows.forEach(function (r) { var v = valOf(r); (by[v] = by[v] || []).push(r); });
            cmpAll.forEach(function (r) { var v = valOf(r); (cby[v] = cby[v] || []).push(r); });
            var list = Object.keys(by).map(function (v) { var st = G.stmt(by[v]), kr = st.rows.filter(function (r) { return r.id === key; })[0]; return { v: v, rows: by[v], st: st, k: kr ? Math.abs(kr.values[0] || 0) : 0 }; }).sort(function (a, b) { return b.k - a.k; });
            var nTop = s.colTop == null ? (cmp ? 8 : 12) : +s.colTop || list.length;
            var top = list.slice(0, nTop), rest = list.slice(top.length), topSet = {};
            top.forEach(function (x) { topSet[x.v] = 1; });
            var grpF = isGrp(f), base = G.grpBase(f), exp = s.cExp = s.cExp || {};
            cols = [];
            top.forEach(function (x) {
                var open = grpF && exp[x.v];
                cols.push({ label: G.valLabel(f, x.v), rows: x.rows, st: x.st, crows: cby[x.v] || [], grp: grpF ? x.v : null, open: open, sub: open });
                if (!open) return;
                // the group opened: one column per value in it (biggest first), the group column stays as its subtotal
                var mb = {}, cmb = {}, bv = function (r) { return r[base] == null ? '' : String(r[base]); };
                x.rows.forEach(function (r) { (mb[bv(r)] = mb[bv(r)] || []).push(r); });
                (cby[x.v] || []).forEach(function (r) { (cmb[bv(r)] = cmb[bv(r)] || []).push(r); });
                Object.keys(mb).map(function (v) { var st = G.stmt(mb[v]), kr = st.rows.filter(function (r) { return r.id === key; })[0]; return { v: v, st: st, k: kr ? Math.abs(kr.values[0] || 0) : 0 }; })
                    .sort(function (a, b) { return b.k - a.k; }).forEach(function (m) { cols.push({ label: G.valLabel(base, m.v), rows: mb[m.v], st: m.st, crows: cmb[m.v] || [], member: x.v }); });
            });
            if (rest.length) cols.push({ label: 'Others (' + rest.length + ')', rows: [].concat.apply([], rest.map(function (x) { return x.rows; })), crows: cmpAll.filter(function (r) { return !topSet[valOf(r)]; }), others: rest.length });
            cols.push({ label: 'Total', st: G.total, rows: G.rows, crows: cmpAll, total: true });
        }
        cols.forEach(function (c) {
            c.st = c.st || G.stmt(c.rows);
            if (cmp) c.cst = G.stmt(c.crows);
            var acc = function (rows) { var m = {}; rows.forEach(function (r) { var x = m[r.account] = m[r.account] || { net: 0, close: 0 }; x.net += r.net; x.close += r.opening + r.net; }); return m; };
            c.acc = acc(c.rows); c.cacc = cmp ? acc(c.crows) : {};
        });
        var tot = cols[cols.length - 1], CL = s.cmp === 'py' ? 'PY' : 'Prev';
        var accVal = function (r, m, a) { var x = m[a]; if (!x) return null; return (r.basis === 'balance' ? x.close : x.net) * (r.sign || 1); };
        var drillable = function (r) { return r.type === 'accounts' && r.accounts && r.accounts.length; };
        var used = function (a) { return [tot.acc[a], tot.cacc[a]].some(function (x) { return x && (Math.abs(x.net) > 0.005 || Math.abs(x.close) > 0.005); }); };
        var accsOf = function (r) { return r.accounts.filter(used).sort(function (a, b) { return Math.abs(accVal(r, tot.acc, b) || 0) - Math.abs(accVal(r, tot.acc, a) || 0); }); };
        var rows = G.total.rows.filter(function (r) { return !r.hidden && r.type !== 'blank'; });
        var pick = function (st, r) { if (!st) return null; var x = st.rows.filter(function (y) { return y.id === r.id && y.label === r.label; })[0]; return x ? x.values[0] : null; };
        var isPct = function (r) { return /^(pct|ratio|days)$/.test(r.format); };
        // the comparison cells: value, comparison, change, change % — green when the change is good for that line
        var cmpCells = function (r, v, cv, tc) {
            if (!cmp) return '';
            if (r.type === 'header') return '<td class="sp-cv' + tc + '"></td><td' + (tc ? ' class="' + tc.trim() + '"' : '') + '></td><td class="sp-cg' + tc + '"></td>';
            var d = v == null && cv == null ? null : (v || 0) - (cv || 0), good = d == null || Math.abs(d) < 0.005 ? '' : (r.favourable === 'down' ? d < 0 : d > 0) ? ' pos' : ' neg';
            var dp = isPct(r) || d == null || !cv ? null : d / Math.abs(cv) * 100;
            return '<td class="n sp-cv' + tc + '">' + G.fmtLine(r, cv) + '</td><td class="n' + good + tc + '">' + (d == null ? '' : isPct(r) ? (d > 0 ? '+' : '') + d.toFixed(1) + ' pts' : (d > 0 ? '+' : '') + money(d)) + '</td>' +
                '<td class="n sp-cg' + good + tc + '">' + (dp == null ? '' : (dp > 0 ? '+' : '') + dp.toFixed(1) + '%') + '</td>';
        };
        var anyLine = rows.some(drillable), html = [], exp = [];
        var sx = function (v, r) { return isPct(r) ? v : v == null ? null : v / (FL.filter.scale || 1); };
        rows.forEach(function (r, ri) {
            var b = r.type === 'group' || r.type === 'formula' || (r.style && r.style.bold), d = drillable(r), open = d && G.cOpen[r.id];
            var accs = d ? accsOf(r) : [];
            html.push('<tr class="' + (r.type === 'header' ? 'sp-h' : b ? 'sp-b' : '') + '" data-r="' + ri + '"><td style="padding-left:' + (8 + (r.level || 0) * 14) + 'px">' +
                (d ? '<span class="sp-tg sp-ctg" title="' + (open ? 'Hide' : 'Show') + ' the accounts">' + (open ? '▾' : '▸') + '</span>' : anyLine ? '<span class="sp-tg0"></span>' : '') + esc(r.label) +
                (d ? ' <span class="muted sm">' + accs.length + ' acc.</span>' : '') + '</td>' +
                cols.map(function (c) { var tc = (c.total ? ' sp-tc' : '') + (c.member ? ' sp-memc' : '') + (c.sub ? ' sp-subc' : ''), v = pick(c.st, r); return '<td class="n' + tc + (cmp ? ' sp-c0' : '') + '">' + (r.type === 'header' ? '' : G.fmtLine(r, v)) + '</td>' + cmpCells(r, v, pick(c.cst, r), tc); }).join('') + '</tr>');
            if (r.type !== 'header') exp.push([r.label].concat([].concat.apply([], cols.map(function (c) { var v = pick(c.st, r), cv = pick(c.cst, r);
                return cmp ? [sx(v, r), sx(cv, r), v == null && cv == null ? null : sx((v || 0) - (cv || 0), r), isPct(r) || !cv ? null : ((v || 0) - cv) / Math.abs(cv) * 100] : [sx(v, r)]; }))));
            if (!open) return;
            if (!accs.length) html.push('<tr class="sp-acc"><td colspan="' + (1 + cols.length * (cmp ? 4 : 1)) + '" class="muted sm" style="padding-left:' + (30 + (r.level || 0) * 14) + 'px">No account of this line has amounts for this choice.</td></tr>');
            accs.forEach(function (a) {
                html.push('<tr class="sp-acc" data-r="' + ri + '" data-a="' + esc(a) + '"><td style="padding-left:' + (30 + (r.level || 0) * 14) + 'px" title="' + esc(a) + '">' + esc(G.valLabel('account', a)) + '</td>' +
                    cols.map(function (c, ci) { var tc = c.total ? ' sp-tc' : '', v = accVal(r, c.acc, a), cv = accVal(r, c.cacc, a);
                        return '<td class="n sp-dc' + tc + (cmp ? ' sp-c0' : '') + '" data-c="' + ci + '"' + (v ? ' title="The balance rows behind this amount"' : '') + '>' + (v ? money(v) : '') + '</td>' +
                            (cmp ? cmpCells(Object.assign({}, r, { format: 'num' }), v, cv, tc).replace('class="n sp-cv' + tc + '"', 'class="n sp-cv sp-dc sp-dcc' + tc + '" data-c="' + ci + '"') : ''); }).join('') + '</tr>');
                exp.push(['   ' + G.valLabel('account', a)].concat([].concat.apply([], cols.map(function (c) { var v = accVal(r, c.acc, a), cv = accVal(r, c.cacc, a);
                    return cmp ? [sx(v, r), sx(cv, r), v == null && cv == null ? null : sx((v || 0) - (cv || 0), r), !cv ? null : ((v || 0) - cv) / Math.abs(cv) * 100] : [sx(v, r)]; }))));
            });
        });
        var nOpen = rows.filter(function (r) { return drillable(r) && G.cOpen[r.id]; }).length;
        var sel = function (id, v, opts) { return '<select id="' + id + '">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (v === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>'; };
        var ctl = '<div class="row sm sp-cctl" style="margin-bottom:6px;flex-wrap:wrap;gap:10px">' +
            '<label>Columns ' + sel('sp-colby', byPer ? 'period' : 'seg', (f ? [['seg', 'one per ' + G.label(f)]] : []).concat([['period', 'one per period']])) + '</label>' +
            (!byPer && f ? '<label>Show ' + sel('sp-top', String(s.colTop == null ? (cmp ? 8 : 12) : s.colTop), [['8', 'top 8'], ['12', 'top 12'], ['20', 'top 20'], ['50', 'top 50'], ['0', 'every value']]) + '</label>' : '') +
            (!byPer && isGrp(f) ? '<button class="btn sm ghost" id="sp-gxall">' + (Object.keys(s.cExp || {}).length ? '<i class="fa-solid fa-compress"></i> Close the groups' : '<i class="fa-solid fa-expand"></i> Open every group') + '</button>' : '') +
            '<label>Compare with ' + sel('sp-cmp', s.cmp, [['none', 'nothing'], ['py', 'same period last year'], ['prev', 'previous period' + (s.periods.length > 1 ? 's' : '')]]) + '</label>' +
            (anyLine ? '<span class="muted">▸ opens a line into its accounts · click an amount for the rows behind it</span>' : '') + '<span class="grow"></span>' +
            (anyLine ? '<button class="btn sm ghost" id="sp-cx">' + (nOpen ? '<i class="fa-solid fa-compress"></i> Close all' : '<i class="fa-solid fa-expand"></i> Open all lines') + '</button>' : '') + '</div>' +
            (cmp && plan.missing.length ? '<div class="callout warn sm" style="margin-bottom:6px"><b>' + esc(plan.missing.map(G.pname).join(', ')) + '</b> ' + (plan.missing.length === 1 ? 'is' : 'are') + ' not on this PC with the extended segments, so ' + (plan.missing.length === 1 ? 'its' : 'their') + ' comparison shows as blank. <a id="sp-gosync">Sync ' + (plan.missing.length === 1 ? 'it' : 'them') + ' in Data › Trial balance sync</a>.</div>' : '');
        var colHead = function (c, ci) {
            if (c.grp != null) return '<a class="sp-gx" data-gx="' + ci + '" title="' + (c.open ? 'Close the group (show it as one column)' : 'Open the group into its values') + '">' + (c.open ? '▾ ' : '▸ ') + esc(c.label) + (c.open ? ' <span class="muted">subtotal</span>' : '') + '</a>';
            if (c.others) return '<a class="sp-gx" data-more="1" title="Show every value as a column">' + esc(c.label) + ' ⊕</a>';
            return esc(c.label);
        };
        var head = cmp
            ? '<tr><th rowspan="2">' + esc(G.tplObj().name) + (f && !byPer ? ' · by ' + esc(G.label(f)) : '') + '</th>' + cols.map(function (c, ci) { return '<th class="sp-gh' + (c.total ? ' sp-tc' : '') + (c.member ? ' sp-mem' : '') + (c.sub ? ' sp-sub' : '') + '" colspan="4">' + colHead(c, ci) + '</th>'; }).join('') + '</tr>' +
              '<tr>' + cols.map(function (c) { var tc = c.total ? ' sp-tc' : ''; return '<th class="n sp-c0' + tc + '">Actual</th><th class="n sp-cv' + tc + '" title="' + esc(byPer ? c.clabel : CL) + '">' + esc(byPer ? c.clabel || CL : CL) + '</th><th class="n' + tc + '">Δ</th><th class="n sp-cg' + tc + '">Δ %</th>'; }).join('') + '</tr>'
            : '<tr><th>' + esc(G.tplObj().name) + (f && !byPer ? ' · by ' + esc(G.label(f)) : '') + '</th>' + cols.map(function (c, ci) { return '<th class="n' + (c.total ? ' sp-tc' : '') + (c.member ? ' sp-mem' : '') + (c.sub ? ' sp-sub' : '') + '">' + colHead(c, ci) + '</th>'; }).join('') + '</tr>';
        out.innerHTML = '<div class="card sp-card">' + ctl + '<div class="scroll" style="max-height:74vh"><table class="t sp-cols' + (cmp ? ' sp-cmp' : '') + '"><thead>' + head + '</thead><tbody>' +
            html.join('') + '</tbody></table></div>' + (f ? '' : '<p class="sm muted">Add a segment on the left to get one column per value (e.g. one per salesperson).</p>') + '</div>';
        G.out = { head: [G.tplObj().name].concat([].concat.apply([], cols.map(function (c) { return cmp ? [c.label, c.label + ' · ' + (byPer ? c.clabel : CL), c.label + ' · Δ', c.label + ' · Δ %'] : [c.label]; }))), rows: exp };
        $('sp-colby').onchange = function () { s.colBy = this.value; save(); G.draw(); };
        if ($('sp-top')) $('sp-top').onchange = function () { s.colTop = +this.value; save(); G.draw(); };
        out.querySelectorAll('[data-gx]').forEach(function (a) { a.onclick = function () { var c = cols[+a.dataset.gx]; s.cExp = s.cExp || {}; if (s.cExp[c.grp]) delete s.cExp[c.grp]; else s.cExp[c.grp] = 1; save(); G.draw(); }; });
        out.querySelectorAll('[data-more]').forEach(function (a) { a.onclick = function () { s.colTop = 0; save(); G.draw(); }; });
        if ($('sp-gxall')) $('sp-gxall').onclick = function () { if (Object.keys(s.cExp || {}).length) s.cExp = {}; else { s.cExp = {}; cols.forEach(function (c) { if (c.grp != null) s.cExp[c.grp] = 1; }); } save(); G.draw(); };
        $('sp-cmp').onchange = function () { s.cmp = this.value; save(); G.run(); };
        if ($('sp-gosync')) $('sp-gosync').onclick = function () { FL.show('data'); setTimeout(function () { if (FL.dataTab) FL.dataTab.go('tbsync'); }, 50); };
        out.querySelectorAll('.sp-ctg').forEach(function (t) { t.onclick = function () { var r = rows[+t.closest('tr').dataset.r]; if (G.cOpen[r.id]) delete G.cOpen[r.id]; else G.cOpen[r.id] = 1; G.draw(); }; });
        if ($('sp-cx')) $('sp-cx').onclick = function () { if (nOpen) G.cOpen = {}; else rows.forEach(function (r) { if (drillable(r)) G.cOpen[r.id] = 1; }); G.draw(); };
        out.querySelectorAll('.sp-dc').forEach(function (td) { td.onclick = function () {
            var tr = td.closest('tr'), r = rows[+tr.dataset.r], c = cols[+td.dataset.c], a = tr.dataset.a, isC = td.classList.contains('sp-dcc');
            G.acctRows((isC ? c.crows : c.rows).filter(function (x) { return x.account === a; }), G.valLabel('account', a) + ' · ' + r.label + ' · ' + c.label + (isC ? ' · ' + (byPer ? c.clabel : CL) : ''));
        }; });
    };
    /** The balance rows (company × segments × period) behind one account amount */
    G.acctRows = function (list, title) {
        var segs = G.fields().filter(function (c) { return list.some(function (r) { return c in r; }); });
        FL.modal('<i class="fa-solid fa-magnifying-glass-dollar"></i> ' + esc(title), '<div id="sp-ar"></div>');
        var cols = [{ label: 'Period', get: function (r) { return G.valLabel('period', r.period); } }, { label: 'Company', get: function (r) { return G.valLabel('company', r.company); } }]
            .concat(segs.map(function (c) { return { label: G.label(c), get: function (r) { return G.valLabel(c, r[c]); } }; }))
            .concat([['Debits', 'dr'], ['Credits', 'cr'], ['Net (debit +)', 'net']].map(function (m) { return { label: m[0], n: true, val: function (r) { return r[m[1]]; }, get: function (r) { return money(r[m[1]]); } }; }));
        FL.grid($('sp-ar'), cols, list.slice().sort(function (a, b) { return Math.abs(b.net) - Math.abs(a.net); }), { id: 'sp-ar-' + segs.join('-'), height: '60vh', max: 2000, csv: 'account-rows.csv' });
    };

    // ── Pivot: rows (several fields, nested with subtotals), one column field, a measure ──
    G.viewPivot = function (out) {
        var s = G.st, pv = s.pv, fields = ['company', 'account', 'period'].concat(G.segs).concat(G.segs.filter(function (c) { return G.grpDef(c); }).map(function (c) { return 'grp_' + c; }));
        var acctLines = G.lineRows(G.total).filter(function (r) { return r.accounts && r.accounts.length; });
        var measures = [['profit', 'Profit (income +, costs −)'], ['net', 'Net movement (debit +)'], ['closing', 'Closing balance']].concat(acctLines.map(function (r) { return ['line:' + r.id, 'Line: ' + r.label]; }));
        if (!measures.some(function (m) { return m[0] === pv.measure; })) pv.measure = 'profit';
        pv.rows = (pv.rows || []).filter(function (f) { return fields.indexOf(f) >= 0; });
        if (!pv.rows.length) pv.rows = s.groups.length ? s.groups.slice() : ['account'];
        var need = pv.rows.concat([pv.col]).filter(function (x) { return x && (segCol(x) || isGrp(x)); }).some(function (x) { return G.rows.length > 0 && !(G.grpBase(x) in G.rows[0]); });
        G.decorate();
        // across periods a Total adds months together, which says little next to a comparison: off by default there, variances on
        var pvVar = pv['var'] || (pv.col === 'period' ? 'prev' : 'none'), pvShow = pv.vshow || 'both', pvTot = pv.tot != null ? pv.tot : pv.col !== 'period';
        var ctl = '<div class="card sp-pctl"><div class="row" style="flex-wrap:wrap;gap:10px"><b class="sm">Rows</b><span id="pv-rows">' + pv.rows.map(function (f, i) { return '<span class="chip on">' + esc(G.label(f)) + ' <a data-pr="' + i + '">×</a></span>'; }).join(' ') + '</span>' +
            '<select id="pv-addr"><option value="">+ row field</option>' + fields.filter(function (f) { return pv.rows.indexOf(f) < 0 && f !== pv.col; }).map(function (f) { return '<option value="' + f + '">' + esc(G.label(f)) + '</option>'; }).join('') + '</select>' +
            '<b class="sm">Columns</b><select id="pv-col"><option value="">(none)</option>' + fields.filter(function (f) { return pv.rows.indexOf(f) < 0; }).map(function (f) { return '<option value="' + f + '"' + (pv.col === f ? ' selected' : '') + '>' + esc(G.label(f)) + '</option>'; }).join('') + '</select>' +
            '<b class="sm">Value</b><select id="pv-m">' + measures.map(function (m) { return '<option value="' + esc(m[0]) + '"' + (pv.measure === m[0] ? ' selected' : '') + '>' + esc(m[1]) + '</option>'; }).join('') + '</select>' +
            (pv.col ? '<b class="sm">Variance</b><select id="pv-var">' + [['none', 'none'], ['prev', 'vs previous column'], ['first', 'vs first column']].map(function (o) { return '<option value="' + o[0] + '"' + (pvVar === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
                (pvVar !== 'none' ? '<select id="pv-vshow">' + [['both', 'Δ and Δ %'], ['abs', 'Δ only'], ['pct', 'Δ % only']].map(function (o) { return '<option value="' + o[0] + '"' + (pvShow === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' : '') +
                '<label class="sm"><input type="checkbox" id="pv-tot"' + (pvTot ? ' checked' : '') + '> Total column</label>' : '') +
            '<a class="sm" id="pv-exp">open all</a> · <a class="sm" id="pv-col0">close all</a></div></div>';
        var wire = function () {
            out.querySelectorAll('[data-pr]').forEach(function (a) { a.onclick = function () { pv.rows.splice(+a.dataset.pr, 1); save(); G.pvReload(); }; });
            $('pv-addr').onchange = function () { if (this.value) { pv.rows.push(this.value); save(); G.pvReload(); } };
            $('pv-col').onchange = function () { pv.col = this.value; save(); G.pvReload(); };
            $('pv-m').onchange = function () { pv.measure = this.value; save(); G.draw(); };
            if ($('pv-var')) $('pv-var').onchange = function () { pv['var'] = this.value; save(); G.draw(); };
            if ($('pv-vshow')) $('pv-vshow').onchange = function () { pv.vshow = this.value; save(); G.draw(); };
            if ($('pv-tot')) $('pv-tot').onchange = function () { pv.tot = this.checked; save(); G.draw(); };
            $('pv-exp').onclick = function () { G.pvOpen = 'all'; G.draw(); };
            $('pv-col0').onclick = function () { G.pvOpen = {}; G.draw(); };
        };
        if (need) { out.innerHTML = ctl + '<div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i></div>'; wire(); G.pvReload(); return; }
        // value per balance row
        var lineAcc = null, lineSign = 1;
        if (pv.measure.indexOf('line:') === 0) { var lr = acctLines.filter(function (r) { return 'line:' + r.id === pv.measure; })[0]; lineAcc = {}; (lr.accounts || []).forEach(function (a) { lineAcc[a] = 1; }); lineSign = lr.sign || 1; }
        var isPl = function (a) { var o = G.accBy[a]; return o ? FINE.isPl(o) : true; };
        var val = function (r) {
            if (lineAcc) return lineAcc[r.account] ? r.net * lineSign : null;
            if (pv.measure === 'net') return r.net;
            if (pv.measure === 'closing') return r.opening + r.net;
            return isPl(r.account) ? -r.net : null;
        };
        var get = function (r, f) { var v = f === 'period' ? r.period : r[f]; return v == null ? '' : String(v); };
        var colVals = [], colSet = {};
        if (pv.col) { G.rows.forEach(function (r) { var v = get(r, pv.col); if (!colSet[v]) { colSet[v] = 1; colVals.push(v); } }); colVals.sort(function (a, b) { return pv.col === 'period' ? +a - +b : String(a).localeCompare(String(b), undefined, { numeric: true }); }); }
        if (colVals.length > 40) colVals = colVals.slice(0, 40);
        var root = { k: {}, t: {}, sum: 0 };
        G.rows.forEach(function (r) {
            var v = val(r); if (v == null || v === 0) return;
            var c = pv.col ? get(r, pv.col) : '', n = root;
            n.sum += v; n.t[c] = (n.t[c] || 0) + v;
            pv.rows.forEach(function (f) { var k = get(r, f); n = n.k[k] = n.k[k] || { k: {}, t: {}, sum: 0 }; n.sum += v; n.t[c] = (n.t[c] || 0) + v; });
        });
        var open = G.pvOpen || (G.pvOpen = {}), html = [], flat = [];
        var lineFav = lineAcc ? (acctLines.filter(function (r) { return 'line:' + r.id === pv.measure; })[0] || {}).favourable : null;
        var judged = pv.measure === 'profit' || !!lineAcc;   // net movement / closing balance: a change is neither good nor bad
        var hasVar = !!pv.col && pvVar !== 'none', showAbs = pvShow !== 'pct', showPct = pvShow !== 'abs', showTot = !pv.col || pvTot;
        var baseOf = function (i) { return i === 0 ? null : pvVar === 'first' ? colVals[0] : colVals[i - 1]; };
        var varOf = function (n, i) { var b = baseOf(i); if (b == null) return null; var v = n.t[colVals[i]], bv = n.t[b]; if (v == null && bv == null) return null; var d = (v || 0) - (bv || 0); return { d: d, p: bv ? d / Math.abs(bv) * 100 : null }; };
        var tone = function (d) { if (!judged || Math.abs(d) < 0.005) return ''; return (lineFav === 'down' ? d < 0 : d > 0) ? ' pos' : ' neg'; };
        var cells = function (n) {
            return (pv.col ? colVals.map(function (c, i) {
                var h = '<td class="n">' + money(n.t[c]) + '</td>';
                if (hasVar && i > 0) { var x = varOf(n, i);
                    if (showAbs) h += '<td class="n sp-vd' + (x ? tone(x.d) : '') + '">' + (x ? (x.d > 0 ? '+' : '') + money(x.d) : '') + '</td>';
                    if (showPct) h += '<td class="n sp-vp' + (x ? tone(x.d) : '') + '">' + (x && x.p != null ? (x.p > 0 ? '+' : '') + x.p.toFixed(1) + '%' : '') + '</td>'; }
                return h; }).join('') : '') + (showTot ? '<td class="n sp-tc">' + money(n.sum) + '</td>' : '');
        };
        var flatCells = function (n) { var sc = FL.filter.scale || 1, o = [];
            if (pv.col) colVals.forEach(function (c, i) { o.push(n.t[c] == null ? null : n.t[c] / sc); if (hasVar && i > 0) { var x = varOf(n, i); if (showAbs) o.push(x ? x.d / sc : null); if (showPct) o.push(x && x.p != null ? Math.round(x.p * 10) / 10 : null); } });
            if (showTot) o.push(n.sum / sc); return o; };
        var bname = function (i) { var b = baseOf(i); return b == null ? '' : G.valLabel(pv.col, b); };
        var walk = function (n, d, path) {
            Object.keys(n.k).sort(function (a, b) { return Math.abs(n.k[b].sum) - Math.abs(n.k[a].sum); }).forEach(function (k) {
                var ch = n.k[k], p = path.concat([k]), key = p.join('\u0001'), leaf = d === pv.rows.length - 1, isOpen = open === 'all' || open[key];
                html.push('<tr class="sp-n d' + d + (leaf ? '' : ' sp-b') + '" data-k="' + esc(key) + '"><td style="padding-left:' + (8 + d * 18) + 'px">' + (leaf ? '<span class="sp-tg0"></span>' : '<a class="sp-tg">' + (isOpen ? '▾' : '▸') + '</a> ') + esc(G.valLabel(pv.rows[d], k)) + '</td>' + cells(ch) + '</tr>');
                flat.push([new Array(d + 1).join('   ') + G.valLabel(pv.rows[d], k)].concat(flatCells(ch)));
                if (!leaf && isOpen) walk(ch, d + 1, p);
            });
        };
        walk(root, 0, []);
        out.innerHTML = ctl + '<div class="card sp-card"><div class="scroll" style="max-height:66vh"><table class="t sp-tree"><thead><tr><th>' + esc(pv.rows.map(G.label).join(' ▸ ')) + '</th>' +
            (pv.col ? colVals.map(function (c, i) { return '<th class="n">' + esc(G.valLabel(pv.col, c)) + '</th>' + (hasVar && i > 0 ? (showAbs ? '<th class="n sp-vd" title="' + esc(G.valLabel(pv.col, c) + ' − ' + bname(i)) + '">Δ vs ' + esc(bname(i)) + '</th>' : '') + (showPct ? '<th class="n sp-vp">' + (showAbs ? 'Δ %' : 'Δ % vs ' + esc(bname(i))) + '</th>' : '') : ''); }).join('') : '') + (showTot ? '<th class="n sp-tc">Total</th>' : '') + '</tr></thead><tbody>' +
            '<tr class="sp-total"><td><b>Total</b></td>' + cells(root).replace(/(<td class="[^"]*">)/g, '$1<b>').replace(/<\/td>/g, '</b></td>') + '</tr>' + html.join('') + '</tbody></table></div></div>';
        var fh = []; if (pv.col) colVals.forEach(function (c, i) { fh.push(G.valLabel(pv.col, c)); if (hasVar && i > 0) { if (showAbs) fh.push('Δ vs ' + bname(i)); if (showPct) fh.push('Δ % vs ' + bname(i)); } });
        G.out = { head: [pv.rows.map(G.label).join(' ▸ ')].concat(fh).concat(showTot ? ['Total'] : []), rows: [['Total'].concat(flatCells(root))].concat(flat) };
        wire();
        out.querySelectorAll('.sp-tg').forEach(function (a) { a.onclick = function () { var k = a.closest('tr').dataset.k; if (G.pvOpen === 'all') G.pvOpen = {}; if (G.pvOpen[k]) delete G.pvOpen[k]; else G.pvOpen[k] = 1; G.draw(); }; });
    };
    G.pvReload = function () { save(); G.run(); };

    // ── Trial balance by company × account × the group segments ──
    G.viewTb = function (out) {
        var s = G.st, segs = s.groups.filter(segCol), by = {}, ps = s.periods.slice().sort();
        var perRow = ps.length > 1 && s.tbBy !== 'sum', span = ps.length > 1 ? G.pname(ps[0]) + ' – ' + G.pname(ps[ps.length - 1]) : G.pname(ps[0]);
        G.rows.forEach(function (r) {
            var k = (perRow ? [r.period_seq] : []).concat([r.company, r.account]).concat(segs.map(function (c) { return r[c] == null ? '' : r[c]; })).join('\u0001');
            var x = by[k] = by[k] || { period: perRow ? G.pname(r.period_seq) : span, seq: perRow ? r.period_seq : ps[0], company: r.company, account: r.account, opening: 0, dr: 0, cr: 0 };
            segs.forEach(function (c) { x[c] = r[c]; });
            x.opening += perRow ? r.opening_p : r.opening; x.dr += r.dr; x.cr += r.cr;
        });
        var list = Object.keys(by).map(function (k) { var x = by[k]; x.closing = x.opening + x.dr - x.cr; return x; }).filter(function (x) { return x.opening || x.dr || x.cr; });
        var t = list.reduce(function (a, x) { a.o += x.opening; a.d += x.dr; a.c += x.cr; return a; }, { o: 0, d: 0, c: 0 });
        out.innerHTML = '<div class="card sp-card"><div class="row" style="flex-wrap:wrap;gap:8px"><b>Trial balance with extended segments · ' + esc(ps.length > 2 && !perRow ? span + ' (' + ps.length + ' periods)' : ps.map(G.pname).join(', ')) + '</b>' +
            (ps.length > 1 ? '<div class="seg" id="sp-tbby"><button data-b="period" class="' + (perRow ? 'on' : '') + '">One row per period</button><button data-b="sum" class="' + (perRow ? '' : 'on') + '">Periods added up</button></div>' : '') +
            '<span class="sm muted">' + (perRow ? 'each period: its opening, debits, credits and closing' : 'opening of ' + esc(G.pname(ps[0])) + ', debits and credits of ' + (ps.length > 1 ? 'all ' + ps.length + ' periods' : 'the period') + ', closing') + '</span><span class="grow"></span>' +
            '<span class="sm">Debits ' + money(t.d) + ' · Credits ' + money(t.c) + ' · ' + (Math.abs(t.d - t.c) < 1 ? '<span class="pos">balanced</span>' : '<span class="neg">difference ' + money(t.d - t.c) + '</span>') + '</span></div><div id="sp-tbg"></div></div>';
        var sc = function (v) { return v / (FL.filter.scale || 1); };
        var cols = [{ label: 'Period', key: 'period', val: function (r) { return r.period; } }, { label: 'Company', key: 'company' }, { label: 'Account', get: function (r) { return G.valLabel('account', r.account); }, val: function (r) { return G.valLabel('account', r.account); } },
            { label: 'Type', get: function (r) { return (G.accBy[r.account] || {}).account_type || ''; } }]
            .concat(segs.map(function (c) { return { label: G.label(c), get: function (r) { return G.valLabel(c, r[c]); } }; }))
            .concat([['Opening', 'opening'], ['Debits', 'dr'], ['Credits', 'cr'], ['Closing', 'closing']].map(function (x) { return { label: x[0], n: 1, get: function (r) { return money(r[x[1]]); }, val: function (r) { return Math.round(sc(r[x[1]]) * 100) / 100; } }; }));
        out.querySelectorAll('#sp-tbby button').forEach(function (b) { b.onclick = function () { s.tbBy = b.dataset.b; save(); G.draw(); }; });
        FL.grid($('sp-tbg'), cols, list.sort(function (a, b) { return a.seq !== b.seq ? a.seq - b.seq : a.company < b.company ? -1 : a.company > b.company ? 1 : a.account < b.account ? -1 : 1; }), { id: 'sp-tb-' + (perRow ? 'p-' : '') + segs.join('-'), height: '62vh', max: 2000, csv: 'trial-balance-segments.csv' });
        G.out = { head: cols.map(function (c) { return c.label; }), rows: list.map(function (r) { return cols.map(function (c) { return c.val ? c.val(r) : c.get ? c.get(r) : r[c.key]; }); }) };
    };

    G.excel = function () {
        if (!G.out || !window.ExcelJS) return;
        var wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Segment P&L');
        ws.addRow([G.tplObj().name + (G.st.groups.length ? ' by ' + G.st.groups.map(G.label).join(' > ') : '')]).font = { bold: true, size: 13 };
        ws.addRow(['Periods: ' + G.st.periods.slice().sort().join(', ') + ' · amounts in ' + FL.scaleLabel()]);
        ws.addRow([]);
        ws.addRow(G.out.head).font = { bold: true };
        G.out.rows.forEach(function (r) { ws.addRow(r); });
        ws.getColumn(1).width = 48; for (var i = 2; i <= G.out.head.length; i++) { ws.getColumn(i).width = 16; ws.getColumn(i).numFmt = '#,##0.0;(#,##0.0);"–"'; }
        ws.views = [{ state: 'frozen', ySplit: 4, xSplit: 1 }];
        wb.xlsx.writeBuffer().then(function (buf) { FL.download('Segment P&L.xlsx', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); });
    };
})();
