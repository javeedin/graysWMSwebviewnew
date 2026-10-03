/* Finance Lens — Segment P&L (tab `segpl`): the P&L — and a trial balance — by the extended segments synced in Data › Trial balance
   sync › Extended segments (DuckDB view fin_gl_ext_v). Left panel: ledger, periods (several), companies, the segments to group by in
   order (e.g. Salesperson ▸ Profit centre; company and account are always in the data), value filters per segment, the statement
   template and its lines. Centre: Tree (one row per segment value, children per next segment, the chosen P&L lines as columns — every
   node is the real template computed by FINE.compute on that node's accounts), By columns (the whole statement with one column per
   value of the first segment), Pivot (rows / columns / measure, subtotals, collapsible) and Trial balance (opening, debits, credits,
   closing per company × account × segments). Selected periods are added up (movement); closing = opening of the first + movement. */
(function () {
    var G = FL.segpl = { st: Object.assign({ ledger: null, periods: [], cos: [], groups: [], filters: {}, view: 'tree', tpl: null, lines: null, pv: { rows: [], col: 'period', measure: 'profit' }, open: {} }, FL.ls('segpl', {})) };
    var save = function () { var s = Object.assign({}, G.st); delete s.open; FL.lsSet('segpl', s); };
    var BASE = { company: 'Company', account: 'Account', period: 'Period' };
    var money = function (v) { return v == null ? '' : FINE.fmt(v / (FL.filter.scale || 1), 'num', { decimals: FL.filter.scale >= 1000000 ? 1 : 0 }); };
    var segCol = function (c) { return /^segment([1-9]|[12][0-9]|30)$/.test(c); };

    FL.TABS.segpl = { render: function (el) { return G.render(el); } };

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
                G.st.groups = (G.st.groups || []).filter(function (g) { return G.segs.indexOf(g) >= 0 || g === 'company'; });
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
    G.label = function (f) { return BASE[f] || (G.segName[f] ? G.segName[f] : f.toUpperCase()) ; };
    G.valLabel = function (f, v) {
        if (v == null || v === '') return '(blank)';
        if (f === 'company') { var c = (FL.dims.companies || []).filter(function (x) { return x.code === v; })[0]; return v + (c && c.name && c.name !== v ? ' · ' + c.name : ''); }
        if (f === 'account') { var a = G.accBy[v]; return v + (a && a.name && a.name !== v ? ' · ' + a.name : ''); }
        if (f === 'period') { var p = G.periods.filter(function (x) { return x.seq === +v; })[0]; return p ? p.name : v; }
        var d = (G.valName[f] || {})[v]; return v + (d && d !== v ? ' · ' + d : '');
    };
    G.tpls = function () { return (FL.stmt && FL.stmt.ofKind ? FL.stmt.ofKind('PL') : FL.templates.filter(function (t) { return t.type === 'PL'; })); };
    G.tplObj = function () { var t = G.tpls(); return t.filter(function (x) { return x.id === G.st.tpl; })[0] || t[0]; };

    // ── data: one query for everything the views need ──
    G.fields = function () {
        var f = (G.st.groups || []).slice();
        (G.st.pv.rows || []).concat([G.st.pv.col]).forEach(function (x) { if (x && segCol(x) && f.indexOf(x) < 0) f.push(x); });
        return f.filter(segCol);
    };
    G.load = function () {
        var L = G.led, ps = G.st.periods.slice().sort(), first = ps[0], fs = G.fields();
        var w = ['ledger_id = ' + (+L.ledger_id), 'period_seq IN (' + ps.join(',') + ')'];
        if (G.st.cos.length) w.push('company IN (' + G.st.cos.map(FL.q).join(',') + ')');
        Object.keys(G.st.filters || {}).forEach(function (c) { var v = G.st.filters[c]; if (segCol(c) && v && v.length) w.push('COALESCE(' + c + ", '') IN (" + v.map(FL.q).join(',') + ')'); });
        var sql = 'SELECT period_seq, company, account' + fs.map(function (c) { return ', ' + c; }).join('') +
            ', SUM(dr - cr) AS net, SUM(dr) AS dr, SUM(cr) AS cr, SUM(CASE WHEN period_seq = ' + first + ' AND NOT adj THEN opening ELSE 0 END) AS opening FROM fin_gl_ext_v WHERE ' + w.join(' AND ') + ' GROUP BY ALL';
        G.sqlText = sql;
        return FL.sql(sql, 400000).then(function (d) {
            G.truncated = d.truncated;
            G.rows = d.rows.map(function (r) { var o = {}; d.columns.forEach(function (c, i) { o[c] = r[i]; }); o.period = String(o.period_seq); o.net = +o.net || 0; o.dr = +o.dr || 0; o.cr = +o.cr || 0; o.opening = +o.opening || 0; return o; });
        });
    };

    // ── the statement of a set of rows: the template computed on those rows' accounts (all chosen periods as one) ──
    G.prep = function () {
        G.accBy = {}; (FL.dims.accounts || []).forEach(function (a) { G.accBy[a.code] = a; });
        var accs = (FL.dims.accounts || []).slice(), seen = {};
        accs.forEach(function (a) { seen[a.code] = 1; });
        (G.rows || []).forEach(function (r) { if (!seen[r.account]) { seen[r.account] = 1; var a = { code: r.account, name: r.account, account_type: FINE.guessType ? FINE.guessType({ code: r.account, name: '' }) : 'E' }; accs.push(a); G.accBy[a.code] = a; } });
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
        var avail = G.segs.filter(function (c) { return s.groups.indexOf(c) < 0; }).concat(s.groups.indexOf('company') < 0 ? ['company'] : []);
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
                    '<a data-f="' + g + '" title="Filter values" class="' + (nf ? 'on' : '') + '"><i class="fa-solid fa-filter"></i>' + (nf ? ' ' + nf : '') + '</a>' +
                    '<a data-up="' + i + '" title="Up"' + (i ? '' : ' class="off"') + '>↑</a><a data-dn="' + i + '" title="Down"' + (i < s.groups.length - 1 ? '' : ' class="off"') + '>↓</a><a data-rm="' + i + '" title="Remove">×</a></div>';
            }).join('') : '<div class="sm muted">Nothing yet — add a segment to see the P&amp;L by it (e.g. Salesperson, then Profit centre under it).</div>') + '</div>' +
            (avail.length ? '<select id="sp-add"><option value="">+ add a segment…</option>' + avail.map(function (c) { return '<option value="' + c + '">' + esc(G.label(c) + (segCol(c) ? ' (' + c.toUpperCase() + ')' : '')) + '</option>'; }).join('') + '</select>' : '') +
            (G.segs.filter(function (c) { return s.groups.indexOf(c) < 0 && (s.filters[c] || []).length; }).map(function (c) { return '<div class="sm">Filter on ' + esc(G.label(c)) + ': ' + s.filters[c].length + ' value(s) <a data-f="' + c + '">change</a></div>'; }).join('')) +
            '<div class="sm" style="margin-top:4px"><a id="sp-flt">Filter another segment…</a></div></div>' +
            '<div class="sp-sec"><div class="row"><b class="sm">Companies</b><span class="grow"></span><a class="sm" id="sp-coall">' + (s.cos.length ? 'all' : '') + '</a></div><div class="sp-cos">' + G.cos.map(function (c) {
                return '<label class="chip' + (s.cos.indexOf(c) >= 0 ? ' on' : '') + '"><input type="checkbox" data-co="' + esc(c) + '"' + (s.cos.indexOf(c) >= 0 ? ' checked' : '') + '>' + esc(c) + '</label>'; }).join('') + '</div>' + (s.cos.length ? '' : '<div class="sm muted">every company</div>') + '</div>' +
            '<div class="sp-sec"><b class="sm">Statement</b><select id="sp-tpl">' + G.tpls().map(function (t) { return '<option value="' + esc(t.id) + '"' + (G.tplObj() === t ? ' selected' : '') + '>' + esc(t.name || t.id) + '</option>'; }).join('') + '</select>' +
            '<div class="sm" style="margin-top:4px"><a id="sp-lines">Lines shown in the tree…</a></div></div>' +
            '<div class="sp-sec sm muted">Data: extended segments synced for ' + esc(L.name || L.ledger_id) + ' (Data › Trial balance sync). Periods chosen are added up; closing = opening of the first + movement.</div>';
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
        if (q('#sp-add')) q('#sp-add').onchange = function () { if (this.value) { s.groups.push(this.value); s.open = {}; rerun(); } };
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
        var pn = s.periods.slice().sort().map(function (q) { return (G.periods.filter(function (p) { return p.seq === q; })[0] || {}).name || q; });
        bar.innerHTML = '<div class="row"><h2 style="margin:0"><i class="fa-solid fa-layer-group"></i> ' + esc(G.tplObj() ? G.tplObj().name : 'P&L') + (s.groups.length ? ' by ' + s.groups.map(G.label).map(esc).join(' ▸ ') : '') + '</h2><span class="grow"></span>' +
            '<div class="seg" id="sp-view">' + [['tree', 'Tree'], ['cols', 'By columns'], ['pivot', 'Pivot'], ['tb', 'Trial balance']].map(function (v) { return '<button data-v="' + v[0] + '" class="' + (s.view === v[0] ? 'on' : '') + '">' + v[1] + '</button>'; }).join('') + '</div>' +
            '<button class="btn sm" id="sp-xl"><i class="fa-solid fa-file-excel"></i> Excel</button></div>' +
            '<div class="sm muted">' + esc(pn.length > 4 ? pn[0] + ' – ' + pn[pn.length - 1] + ' (' + pn.length + ' periods)' : pn.join(', ')) + ' · ' + (s.cos.length ? s.cos.length + ' compan' + (s.cos.length === 1 ? 'y' : 'ies') : 'every company') + ' · amounts in ' + FL.scaleLabel() +
            ' · ' + G.rows.length.toLocaleString() + ' balance rows' + (G.truncated ? ' <b class="neg">(cut at 400,000 — narrow the periods or filters)</b>' : '') + '</div>';
        bar.querySelectorAll('#sp-view button').forEach(function (b) { b.onclick = function () { s.view = b.dataset.v; save(); G.draw(); }; });
        $('sp-xl').onclick = G.excel;
        G.out = null;
        if (s.view === 'cols') G.viewCols(out); else if (s.view === 'pivot') G.viewPivot(out); else if (s.view === 'tb') G.viewTb(out); else G.viewTree(out);
    };

    // ── Tree: one row per value of the first segment, children per next segment, chosen lines as columns ──
    G.viewTree = function (out) {
        var s = G.st, lines = (s.lines || G.defLines(G.total)).map(function (id) { return G.total.rows.filter(function (r) { return r.id === id; })[0]; }).filter(Boolean);
        var groups = s.groups, sortI = 0, html = [], flat = [];
        var vals = function (st) { return lines.map(function (l) { var r = st.rows.filter(function (x) { return x.id === l.id; })[0]; return r ? r.values[0] : null; }); };
        var node = function (rows, depth, path) {
            var f = groups[depth], by = {};
            rows.forEach(function (r) { var v = f === 'company' ? r.company : r[f]; v = v == null ? '' : String(v); (by[v] = by[v] || []).push(r); });
            var kids = Object.keys(by).map(function (v) { var st = G.stmt(by[v]); return { v: v, rows: by[v], vals: vals(st) }; })
                .filter(function (k) { return k.vals.some(function (x) { return x != null && Math.abs(x) >= 0.005; }); });   // a value with no P&L (e.g. balance-sheet only) is left out
            kids.sort(function (a, b) { return Math.abs(b.vals[sortI] || 0) - Math.abs(a.vals[sortI] || 0); });
            kids.forEach(function (k) {
                var p = path.concat([k.v]), key = p.join('\u0001'), hasKids = depth < groups.length - 1, open = !!s.open[key];
                html.push('<tr class="sp-n d' + depth + '" data-k="' + esc(key) + '"><td style="padding-left:' + (8 + depth * 18) + 'px">' + (hasKids ? '<a class="sp-tg">' + (open ? '▾' : '▸') + '</a> ' : '<span class="sp-tg0"></span>') +
                    '<span class="muted sm">' + esc(G.label(f)) + '</span> ' + esc(G.valLabel(f, k.v)) + ' <a class="sp-full" title="The whole statement for this">⋯</a></td>' +
                    k.vals.map(function (v, i) { return '<td class="n' + (v < 0 && lines[i].format !== 'pct' ? ' neg' : '') + '">' + G.fmtLine(lines[i], v) + '</td>'; }).join('') + '</tr>');
                flat.push([new Array(depth + 1).join('   ') + G.valLabel(f, k.v)].concat(k.vals.map(function (v, i) { return /^(pct|ratio|days)$/.test(lines[i].format) ? v : v == null ? null : v / (FL.filter.scale || 1); })));
                G.nodes[key] = { rows: k.rows, label: p.map(function (x, i) { return G.label(groups[i]) + ' ' + G.valLabel(groups[i], x); }).join(' ▸ ') };
                if (hasKids && open) node(k.rows, depth + 1, p);
            });
        };
        G.nodes = {};
        var tv = vals(G.total);
        if (groups.length) node(G.rows, 0, []);
        out.innerHTML = '<div class="card sp-card"><div class="scroll" style="max-height:72vh"><table class="t sp-tree"><thead><tr><th>' + (groups.length ? esc(groups.map(G.label).join(' ▸ ')) : 'Total') + '</th>' + lines.map(function (l) { return '<th class="n">' + esc(l.label) + '</th>'; }).join('') + '</tr></thead><tbody>' +
            '<tr class="sp-total"><td><b>Total</b> <a class="sp-full" data-total="1" title="The whole statement">⋯</a></td>' + tv.map(function (v, i) { return '<td class="n"><b>' + G.fmtLine(lines[i], v) + '</b></td>'; }).join('') + '</tr>' + html.join('') + '</tbody></table></div>' +
            (groups.length ? '' : '<p class="sm muted">Add a segment on the left (e.g. Salesperson) to split the P&amp;L by it; add a second one (e.g. Profit centre) to open each value into the next.</p>') +
            '<p class="sm muted">Click ▸ to open the next segment · ⋯ = the whole statement for that row · columns: <a id="sp-lines2">choose the lines</a></p></div>';
        G.out = { head: [groups.map(G.label).join(' ▸ ') || 'Total'].concat(lines.map(function (l) { return l.label; })), rows: [['Total'].concat(tv.map(function (v, i) { return /^(pct|ratio|days)$/.test(lines[i].format) ? v : v == null ? null : v / (FL.filter.scale || 1); }))].concat(flat) };
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
        var s = G.st, f = s.groups[0], key = (s.lines || G.defLines(G.total))[0];
        var cols = [{ label: 'Total', st: G.total, rows: G.rows }];
        if (f) {
            var by = {}; G.rows.forEach(function (r) { var v = f === 'company' ? r.company : r[f]; v = v == null ? '' : String(v); (by[v] = by[v] || []).push(r); });
            var list = Object.keys(by).map(function (v) { var st = G.stmt(by[v]), kr = st.rows.filter(function (r) { return r.id === key; })[0]; return { v: v, rows: by[v], st: st, k: kr ? Math.abs(kr.values[0] || 0) : 0 }; }).sort(function (a, b) { return b.k - a.k; });
            var top = list.slice(0, 12), rest = list.slice(12);
            cols = top.map(function (x) { return { label: G.valLabel(f, x.v), st: x.st, rows: x.rows }; });
            if (rest.length) { var rr = [].concat.apply([], rest.map(function (x) { return x.rows; })); cols.push({ label: 'Others (' + rest.length + ')', st: G.stmt(rr), rows: rr }); }
            cols.push({ label: 'Total', st: G.total, rows: G.rows, total: true });
        }
        // per column: account → { net, close }
        cols.forEach(function (c) { var m = c.acc = {}; c.rows.forEach(function (r) { var x = m[r.account] = m[r.account] || { net: 0, close: 0 }; x.net += r.net; x.close += r.opening + r.net; }); });
        var tot = cols[cols.length - 1];
        var accVal = function (r, c, a) { var x = c.acc[a]; if (!x) return null; return (r.basis === 'balance' ? x.close : x.net) * (r.sign || 1); };
        var drillable = function (r) { return r.type === 'accounts' && r.accounts && r.accounts.length; };
        var accsOf = function (r) { return r.accounts.filter(function (a) { return tot.acc[a] && (Math.abs(tot.acc[a].net) > 0.005 || Math.abs(tot.acc[a].close) > 0.005); }).sort(function (a, b) { return Math.abs(accVal(r, tot, b)) - Math.abs(accVal(r, tot, a)); }); };
        var rows = G.total.rows.filter(function (r) { return !r.hidden && r.type !== 'blank'; });
        var cell = function (r, c) { var x = c.st.rows.filter(function (y) { return y.id === r.id && y.label === r.label; })[0]; return x ? x.values[0] : null; };
        var anyLine = rows.some(drillable);
        var html = [], exp = [];
        rows.forEach(function (r, ri) {
            var b = r.type === 'group' || r.type === 'formula' || (r.style && r.style.bold), d = drillable(r), open = d && G.cOpen[r.id];
            var accs = d ? accsOf(r) : [];
            html.push('<tr class="' + (r.type === 'header' ? 'sp-h' : b ? 'sp-b' : '') + '" data-r="' + ri + '"><td style="padding-left:' + (8 + (r.level || 0) * 14) + 'px">' +
                (d ? '<span class="sp-tg sp-ctg" title="' + (open ? 'Hide' : 'Show') + ' the accounts">' + (open ? '▾' : '▸') + '</span>' : anyLine ? '<span class="sp-tg0"></span>' : '') + esc(r.label) +
                (d ? ' <span class="muted sm">' + accs.length + ' acc.</span>' : '') + '</td>' +
                cols.map(function (c) { return '<td class="n' + (c.total ? ' sp-tc' : '') + '">' + (r.type === 'header' ? '' : G.fmtLine(r, cell(r, c))) + '</td>'; }).join('') + '</tr>');
            if (r.type !== 'header') exp.push([r.label].concat(cols.map(function (c) { var v = cell(r, c); return /^(pct|ratio|days)$/.test(r.format) ? v : v == null ? null : v / (FL.filter.scale || 1); })));
            if (!open) return;
            if (!accs.length) html.push('<tr class="sp-acc"><td colspan="' + (cols.length + 1) + '" class="muted sm" style="padding-left:' + (30 + (r.level || 0) * 14) + 'px">No account of this line has amounts for this choice.</td></tr>');
            accs.forEach(function (a) {
                html.push('<tr class="sp-acc" data-r="' + ri + '" data-a="' + esc(a) + '"><td style="padding-left:' + (30 + (r.level || 0) * 14) + 'px" title="' + esc(a) + '">' + esc(G.valLabel('account', a)) + '</td>' +
                    cols.map(function (c, ci) { var v = accVal(r, c, a); return '<td class="n sp-dc' + (c.total ? ' sp-tc' : '') + '" data-c="' + ci + '"' + (v ? ' title="The balance rows behind this amount"' : '') + '>' + (v ? money(v) : '') + '</td>'; }).join('') + '</tr>');
                exp.push(['   ' + G.valLabel('account', a)].concat(cols.map(function (c) { var v = accVal(r, c, a); return v == null ? null : v / (FL.filter.scale || 1); })));
            });
        });
        var nOpen = rows.filter(function (r) { return drillable(r) && G.cOpen[r.id]; }).length;
        out.innerHTML = '<div class="card sp-card">' + (anyLine ? '<div class="row sm" style="margin-bottom:6px"><span class="muted">▸ opens a line into its accounts · click an account amount for the rows behind it</span><span class="grow"></span>' +
            '<button class="btn sm ghost" id="sp-cx">' + (nOpen ? '<i class="fa-solid fa-compress"></i> Close all' : '<i class="fa-solid fa-expand"></i> Open all lines') + '</button></div>' : '') +
            '<div class="scroll" style="max-height:74vh"><table class="t sp-cols"><thead><tr><th>' + esc(G.tplObj().name) + (f ? ' · by ' + esc(G.label(f)) : '') + '</th>' + cols.map(function (c) { return '<th class="n' + (c.total ? ' sp-tc' : '') + '">' + esc(c.label) + '</th>'; }).join('') + '</tr></thead><tbody>' +
            html.join('') + '</tbody></table></div>' + (f ? '' : '<p class="sm muted">Add a segment on the left to get one column per value (e.g. one per salesperson).</p>') + '</div>';
        G.out = { head: [G.tplObj().name].concat(cols.map(function (c) { return c.label; })), rows: exp };
        out.querySelectorAll('.sp-ctg').forEach(function (t) { t.onclick = function () { var r = rows[+t.closest('tr').dataset.r]; if (G.cOpen[r.id]) delete G.cOpen[r.id]; else G.cOpen[r.id] = 1; G.draw(); }; });
        if ($('sp-cx')) $('sp-cx').onclick = function () { if (nOpen) G.cOpen = {}; else rows.forEach(function (r) { if (drillable(r)) G.cOpen[r.id] = 1; }); G.draw(); };
        out.querySelectorAll('.sp-dc').forEach(function (td) { td.onclick = function () {
            var tr = td.closest('tr'), r = rows[+tr.dataset.r], c = cols[+td.dataset.c], a = tr.dataset.a;
            G.acctRows(c.rows.filter(function (x) { return x.account === a; }), G.valLabel('account', a) + ' · ' + r.label + ' · ' + c.label);
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
        var s = G.st, pv = s.pv, fields = ['company', 'account', 'period'].concat(G.segs);
        var acctLines = G.lineRows(G.total).filter(function (r) { return r.accounts && r.accounts.length; });
        var measures = [['profit', 'Profit (income +, costs −)'], ['net', 'Net movement (debit +)'], ['closing', 'Closing balance']].concat(acctLines.map(function (r) { return ['line:' + r.id, 'Line: ' + r.label]; }));
        if (!measures.some(function (m) { return m[0] === pv.measure; })) pv.measure = 'profit';
        pv.rows = (pv.rows || []).filter(function (f) { return fields.indexOf(f) >= 0; });
        if (!pv.rows.length) pv.rows = s.groups.length ? s.groups.slice() : ['account'];
        var need = pv.rows.concat([pv.col]).filter(function (x) { return x && segCol(x); }).some(function (x) { return G.rows.length > 0 && !(x in G.rows[0]); });
        var ctl = '<div class="card sp-pctl"><div class="row" style="flex-wrap:wrap;gap:10px"><b class="sm">Rows</b><span id="pv-rows">' + pv.rows.map(function (f, i) { return '<span class="chip on">' + esc(G.label(f)) + ' <a data-pr="' + i + '">×</a></span>'; }).join(' ') + '</span>' +
            '<select id="pv-addr"><option value="">+ row field</option>' + fields.filter(function (f) { return pv.rows.indexOf(f) < 0 && f !== pv.col; }).map(function (f) { return '<option value="' + f + '">' + esc(G.label(f)) + '</option>'; }).join('') + '</select>' +
            '<b class="sm">Columns</b><select id="pv-col"><option value="">(none)</option>' + fields.filter(function (f) { return pv.rows.indexOf(f) < 0; }).map(function (f) { return '<option value="' + f + '"' + (pv.col === f ? ' selected' : '') + '>' + esc(G.label(f)) + '</option>'; }).join('') + '</select>' +
            '<b class="sm">Value</b><select id="pv-m">' + measures.map(function (m) { return '<option value="' + esc(m[0]) + '"' + (pv.measure === m[0] ? ' selected' : '') + '>' + esc(m[1]) + '</option>'; }).join('') + '</select>' +
            '<a class="sm" id="pv-exp">open all</a> · <a class="sm" id="pv-col0">close all</a></div></div>';
        var wire = function () {
            out.querySelectorAll('[data-pr]').forEach(function (a) { a.onclick = function () { pv.rows.splice(+a.dataset.pr, 1); save(); G.pvReload(); }; });
            $('pv-addr').onchange = function () { if (this.value) { pv.rows.push(this.value); save(); G.pvReload(); } };
            $('pv-col').onchange = function () { pv.col = this.value; save(); G.pvReload(); };
            $('pv-m').onchange = function () { pv.measure = this.value; save(); G.draw(); };
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
        var cells = function (n) { return (pv.col ? colVals.map(function (c) { return '<td class="n">' + money(n.t[c]) + '</td>'; }).join('') : '') + '<td class="n sp-tc">' + money(n.sum) + '</td>'; };
        var walk = function (n, d, path) {
            Object.keys(n.k).sort(function (a, b) { return Math.abs(n.k[b].sum) - Math.abs(n.k[a].sum); }).forEach(function (k) {
                var ch = n.k[k], p = path.concat([k]), key = p.join('\u0001'), leaf = d === pv.rows.length - 1, isOpen = open === 'all' || open[key];
                html.push('<tr class="sp-n d' + d + (leaf ? '' : ' sp-b') + '" data-k="' + esc(key) + '"><td style="padding-left:' + (8 + d * 18) + 'px">' + (leaf ? '<span class="sp-tg0"></span>' : '<a class="sp-tg">' + (isOpen ? '▾' : '▸') + '</a> ') + esc(G.valLabel(pv.rows[d], k)) + '</td>' + cells(ch) + '</tr>');
                flat.push([new Array(d + 1).join('   ') + G.valLabel(pv.rows[d], k)].concat(pv.col ? colVals.map(function (c) { return ch.t[c] == null ? null : ch.t[c] / (FL.filter.scale || 1); }) : []).concat([ch.sum / (FL.filter.scale || 1)]));
                if (!leaf && isOpen) walk(ch, d + 1, p);
            });
        };
        walk(root, 0, []);
        out.innerHTML = ctl + '<div class="card sp-card"><div class="scroll" style="max-height:66vh"><table class="t sp-tree"><thead><tr><th>' + esc(pv.rows.map(G.label).join(' ▸ ')) + '</th>' +
            (pv.col ? colVals.map(function (c) { return '<th class="n">' + esc(G.valLabel(pv.col, c)) + '</th>'; }).join('') : '') + '<th class="n sp-tc">Total</th></tr></thead><tbody>' +
            '<tr class="sp-total"><td><b>Total</b></td>' + cells(root).replace(/<td class="n( sp-tc)?">/g, '<td class="n$1"><b>').replace(/<\/td>/g, '</b></td>') + '</tr>' + html.join('') + '</tbody></table></div></div>';
        G.out = { head: [pv.rows.map(G.label).join(' ▸ ')].concat(pv.col ? colVals.map(function (c) { return G.valLabel(pv.col, c); }) : []).concat(['Total']), rows: flat };
        wire();
        out.querySelectorAll('.sp-tg').forEach(function (a) { a.onclick = function () { var k = a.closest('tr').dataset.k; if (G.pvOpen === 'all') G.pvOpen = {}; if (G.pvOpen[k]) delete G.pvOpen[k]; else G.pvOpen[k] = 1; G.draw(); }; });
    };
    G.pvReload = function () { save(); G.run(); };

    // ── Trial balance by company × account × the group segments ──
    G.viewTb = function (out) {
        var s = G.st, segs = s.groups.filter(segCol), by = {};
        G.rows.forEach(function (r) {
            var k = [r.company, r.account].concat(segs.map(function (c) { return r[c] == null ? '' : r[c]; })).join('\u0001');
            var x = by[k] = by[k] || { company: r.company, account: r.account, opening: 0, dr: 0, cr: 0 };
            segs.forEach(function (c) { x[c] = r[c]; });
            x.opening += r.opening; x.dr += r.dr; x.cr += r.cr;
        });
        var list = Object.keys(by).map(function (k) { var x = by[k]; x.closing = x.opening + x.dr - x.cr; return x; }).filter(function (x) { return x.opening || x.dr || x.cr; });
        var t = list.reduce(function (a, x) { a.o += x.opening; a.d += x.dr; a.c += x.cr; return a; }, { o: 0, d: 0, c: 0 });
        out.innerHTML = '<div class="card sp-card"><div class="row"><b>Trial balance with extended segments</b><span class="sm muted">opening of the first period, debits and credits of the chosen periods, closing</span><span class="grow"></span>' +
            '<span class="sm">Debits ' + money(t.d) + ' · Credits ' + money(t.c) + ' · ' + (Math.abs(t.d - t.c) < 1 ? '<span class="pos">balanced</span>' : '<span class="neg">difference ' + money(t.d - t.c) + '</span>') + '</span></div><div id="sp-tbg"></div></div>';
        var sc = function (v) { return v / (FL.filter.scale || 1); };
        var cols = [{ label: 'Company', key: 'company' }, { label: 'Account', get: function (r) { return G.valLabel('account', r.account); }, val: function (r) { return G.valLabel('account', r.account); } },
            { label: 'Type', get: function (r) { return (G.accBy[r.account] || {}).account_type || ''; } }]
            .concat(segs.map(function (c) { return { label: G.label(c), get: function (r) { return G.valLabel(c, r[c]); } }; }))
            .concat([['Opening', 'opening'], ['Debits', 'dr'], ['Credits', 'cr'], ['Closing', 'closing']].map(function (x) { return { label: x[0], n: 1, get: function (r) { return money(r[x[1]]); }, val: function (r) { return Math.round(sc(r[x[1]]) * 100) / 100; } }; }));
        FL.grid($('sp-tbg'), cols, list.sort(function (a, b) { return a.company < b.company ? -1 : a.company > b.company ? 1 : a.account < b.account ? -1 : 1; }), { id: 'sp-tb-' + segs.join('-'), height: '62vh', max: 2000, csv: 'trial-balance-segments.csv' });
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
