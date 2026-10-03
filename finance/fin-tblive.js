/* Finance Lens — Trial balance live from Fusion (Statements › Trial balance › Live from Fusion; also before any data is
   loaded): one ledger and period read straight from GL_BALANCES by the host (finFusionTb, FinanceFusion.TrialBalanceAsync)
   grouped by company × account (× cost centre) — opening, PTD debits / credits, QTD, YTD, closing — in ranked chunks with the
   live monitor (the SQL running now, sample rows, log). Account / company names come from this PC (DuckDB accounts or segment
   values), else APEX segment values — never from the value sets in the query, so the Fusion read stays small.
   Save to DuckDB (fin_tb_live, host finTbSave) and APEX (WMS_FIN_TB_LIVE); saved trial balances reopen without Fusion;
   compared line by line with the balances loaded on this PC when that ledger and period are loaded. */
(function () {
    var T = FL.tb;
    var L = T.live = { pod: FL.ls('tbl.pod', null), ledger: FL.ls('tbl.ledger', null), seq: null, cos: [], byCc: FL.ls('tbl.byCc', false), fold: true, par: FL.ls('tbl.par', 2), page: FL.ls('tbl.page', 5000), query: FL.ls('tbl.query', ''), defaultQuery: FL.ls('tbl.defaultQuery', ''),
        view: FL.ls('tbl.view', 'account'), q: '', zero: true, scale: FL.ls('tbl.scale', 1), compare: FL.ls('tbl.compare', true), res: null };
    T.source = FL.ls('tb.source', 'duck');
    var TYPE = { A: 'Asset', L: 'Liability', O: 'Equity', R: 'Revenue', E: 'Expense' };

    /** Template chips + data source switch shared by both trial balance views */
    T.head = function (live) {
        var loaded = FL.status && FL.status.loaded;
        return '<div class="row toolbar" style="margin-bottom:10px"><div class="seg" id="st-tpls">' + (FL.templates || []).map(function (t) {
            return '<button data-t="' + esc(t.id) + '"' + (loaded ? '' : ' disabled title="Load the finance data first (Data › Sync status) — the trial balance works live from Fusion now"') + '>' + esc(t.name) + '</button>';
        }).join('') + '<button data-t="TB" class="on"><i class="fa-solid fa-scale-balanced"></i> Trial balance</button></div>' +
            '<div class="seg" id="tb-src"><button data-s="duck" class="' + (!live ? 'on' : '') + '"' + (loaded ? '' : ' disabled title="Nothing loaded on this PC yet"') + '><i class="fa-solid fa-database"></i> This PC</button>' +
            '<button data-s="live" class="' + (live ? 'on' : '') + '"><i class="fa-solid fa-bolt"></i> Live from Fusion</button></div><span class="grow"></span>';
    };
    T.wireHead = function (el) {
        el.querySelectorAll('#st-tpls button').forEach(function (b) { b.onclick = function () { if (b.disabled) return; FL.stmt.tpl = b.dataset.t; FL.lsSet('stmt.tpl', b.dataset.t); FL.render(); }; });
        el.querySelectorAll('#tb-src button').forEach(function (b) { b.onclick = function () { if (b.disabled) return; T.source = b.dataset.s; FL.lsSet('tb.source', T.source); FL.render(); }; });
    };

    // ═════ the live view ═════
    T.renderLive = function (el) {
        var loaded = FL.status && FL.status.loaded, s = FL.fusion.saved() || {};
        if (L.pod == null) L.pod = (s.setup && s.setup.pod) || s.pod || '';
        el.innerHTML = T.head(true) + '</div>' +
            (loaded ? '' : '<div class="callout sm"><i class="fa-solid fa-circle-info"></i> No finance data is loaded on this PC yet — the income statement, balance sheet and cash flow need a load (<a onclick="FL.dataTab.go(\'status\')">Data › Sync status</a>); the trial balance below reads Fusion directly.</div>') +
            '<div class="card"><div class="row"><h3 style="margin:0"><i class="fa-solid fa-bolt"></i> Trial balance live from Fusion</h3><span class="sm muted">GL_BALANCES of one ledger and period · grouped by company × account · names from this PC</span></div>' +
            '<div class="row" style="margin-top:10px"><label class="sm">Pod <select id="tl-pod"><option value="">Logged-in pod</option><option value="PROD"' + (L.pod === 'PROD' ? ' selected' : '') + '>PROD</option><option value="TEST"' + (L.pod === 'TEST' ? ' selected' : '') + '>TEST</option></select></label>' +
            '<label class="sm">Ledger <select id="tl-led"><option>…</option></select></label><label class="sm">Period <select id="tl-per"></select></label>' +
            '<label class="sm"><input type="checkbox" id="tl-cc"' + (L.byCc ? ' checked' : '') + '> by cost centre</label>' +
            '<label class="sm"><input type="checkbox" id="tl-fold"' + (L.fold ? ' checked' : '') + ' title="Adjustment periods (e.g. Adj-25) are added to the period they close"> fold adjustment periods</label>' +
            '<label class="sm" title="Each period is read in pages of this many rows (code_combination_id order, each page after the last id), so no single query returns too much and times out">Rows per fetch <select id="tl-page">' + [1000, 2000, 5000, 10000, 20000].map(function (n) { return '<option value="' + n + '"' + (L.page === n ? ' selected' : '') + '>' + n.toLocaleString() + '</option>'; }).join('') + '</select></label>' +
            '<label class="sm" title="One query per period and company runs at a time per slot; a query that still times out is split by account ranges">Reads in parallel <select id="tl-par">' + [1, 2, 3, 4].map(function (n) { return '<option' + (L.par === n ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label>' +
            '<label class="sm" title="This PC keeps the GL_BALANCES rows of every ledger and period it has read (DuckDB fin_gl_balances, every column) and builds the trial balance from them. Tick to read the periods from Fusion again, e.g. after postings."><input type="checkbox" id="tl-ref"> read again from Fusion</label>' +
            '<button class="btn primary" id="tl-go"><i class="fa-solid fa-bolt"></i> Fetch from Fusion</button></div>' +
            '<div class="row" style="margin-top:6px"><span class="sm muted">Companies</span><div id="tl-cos" class="tl-cos"></div></div>' +
            '<details class="tl-q" id="tl-qbox"' + (L.query ? ' open' : '') + '><summary><b><i class="fa-solid fa-code"></i> GL_BALANCES query</b> <span class="sm muted" id="tl-qstate">' + (L.query ? 'your own query' : 'default') + '</span></summary>' +
            '<p class="sm muted">One query per period. <code>{LEDGER_ID}</code>, <code>{PERIOD}</code> and <code>{CURRENCY}</code> are filled in for each period read (the period, its adjustment period, the start of the quarter and of the year). ' +
            'It must return CODE_COMBINATION_ID, BEGIN_BALANCE_DR, BEGIN_BALANCE_CR, PERIOD_NET_DR and PERIOD_NET_CR; every column it returns is kept on this PC (fin_gl_balances). Read-only: SELECT / WITH.</p>' +
            '<textarea id="tl-qtext" spellcheck="false" rows="6">' + esc(L.query || L.defaultQuery || "SELECT b.* FROM gl_balances b WHERE b.ledger_id = {LEDGER_ID} AND b.period_name = '{PERIOD}' AND b.currency_code = '{CURRENCY}' AND b.actual_flag = 'A'") + '</textarea>' +
            '<div class="row"><button class="btn primary sm" id="tl-qrun"><i class="fa-solid fa-play"></i> Run with this query</button><button class="btn sm" id="tl-qreset"><i class="fa-solid fa-rotate-left"></i> Default query</button>' +
            '<span class="sm muted">Run re-reads the periods from Fusion with this query (the copy on this PC is replaced).</span></div></details>' +
            '<div id="fu-prog"></div></div><div id="tl-res"></div>' +
            '<div class="card" style="margin-top:12px"><h3><i class="fa-solid fa-database"></i> GL balances kept on this PC <small>GL_BALANCES rows with all their columns, per ledger and period (DuckDB fin_gl_balances) — a trial balance reads Fusion only for periods missing here</small></h3><div id="tl-raw"></div></div>' +
            '<div class="card" style="margin-top:12px"><h3><i class="fa-solid fa-box-archive"></i> Saved trial balances <small>open without asking Fusion</small></h3><div id="tl-saved"><div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i></div></div></div>';
        T.wireHead(el);
        FL.fusion.paint();
        $('tl-pod').onchange = function () { L.pod = this.value; FL.lsSet('tbl.pod', L.pod); L.ledger = null; T.fillLedgers(); };
        $('tl-cc').onchange = function () { L.byCc = this.checked; FL.lsSet('tbl.byCc', L.byCc); };
        $('tl-fold').onchange = function () { L.fold = this.checked; };
        $('tl-page').onchange = function () { L.page = +this.value; FL.lsSet('tbl.page', L.page); };
        $('tl-par').onchange = function () { L.par = +this.value; FL.lsSet('tbl.par', L.par); };
        $('tl-go').onclick = function () { T.fetch(); };
        $('tl-qrun').onclick = function () {
            var q = $('tl-qtext').value.trim();
            if (!/^\s*(select|with)\b/i.test(q)) { FL.toast('The query must start with SELECT or WITH', 'err'); return; }
            if (!/\{PERIOD\}/.test(q)) { if (!confirm('The query has no {PERIOD} placeholder — every period read would return the same rows. Run it anyway?')) return; }
            L.query = (L.defaultQuery && q === L.defaultQuery.trim()) ? '' : q;
            FL.lsSet('tbl.query', L.query); $('tl-qstate').textContent = L.query ? 'your own query' : 'default';
            T.fetch(true);
        };
        $('tl-qreset').onclick = function () { L.query = ''; FL.lsSet('tbl.query', ''); $('tl-qtext').value = L.defaultQuery || $('tl-qtext').value; $('tl-qstate').textContent = 'default'; };
        T.fillLedgers();
        T.listSaved();
        if (L.res) T.show();
    };

    T.fillLedgers = function () {
        var pod = L.pod || '';
        $('tl-led').innerHTML = '<option>reading the chart of accounts…</option>';
        return FL.fusion.getDisc(pod).then(function (r) {
            if ((L.pod || '') !== pod || !$('tl-led')) return;
            if (!r) { L.disc = null; $('tl-led').innerHTML = '<option value="">— discover first —</option>'; $('tl-cos').innerHTML = '<span class="sm">Nothing discovered for ' + esc(pod || 'the logged-in pod') + ' — <a onclick="FL.dataTab.dataSetup()">Discover the ledgers</a> once.</span>'; return; }
            L.disc = r.disc;
            var leds = (r.disc.ledgers || []).filter(function (l) { return l.coaId; }), def = FL.fusion.defaultIds(r.disc);
            if (!leds.some(function (l) { return String(l.id) === String(L.ledger); })) L.ledger = def[0] || (leds[0] && String(leds[0].id));
            $('tl-led').innerHTML = leds.map(function (l) { return '<option value="' + esc(l.id) + '"' + (String(l.id) === String(L.ledger) ? ' selected' : '') + '>' + esc(l.name + ' · ' + l.currency + (l.category && l.category !== 'PRIMARY' ? ' · ' + l.category.toLowerCase() : '')) + '</option>'; }).join('');
            $('tl-led').onchange = function () { L.ledger = this.value; FL.lsSet('tbl.ledger', L.ledger); L.cos = []; T.fillPeriods(); };
            T.fillPeriods();
        });
    };
    T.ledgerObj = function () { return L.disc ? (L.disc.ledgers || []).filter(function (l) { return String(l.id) === String(L.ledger); })[0] : null; };
    T.fillPeriods = function () {
        var l = T.ledgerObj(); if (!l) return;
        var cal = FL.fusion.calOf(L.disc, l), today = new Date().toISOString().slice(0, 10), started = cal.filter(function (p) { return !p.start || p.start <= today; });
        if (!cal.some(function (p) { return p.seq === L.seq; })) L.seq = started.length ? started[started.length - 1].seq : (cal[cal.length - 1] || {}).seq;
        $('tl-per').innerHTML = cal.slice().reverse().map(function (p) { return '<option value="' + p.seq + '"' + (p.seq === L.seq ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('');
        $('tl-per').onchange = function () { L.seq = +this.value; };
        var cos = l.companies || [];
        $('tl-cos').innerHTML = cos.length ? '<label class="chip"><input type="checkbox" id="tl-all"' + (L.cos.length ? '' : ' checked') + '> all ' + cos.length + '</label>' + cos.map(function (c) {
            return '<label class="chip"><input type="checkbox" class="tl-co" value="' + esc(c.value) + '"' + (L.cos.indexOf(c.value) >= 0 ? ' checked' : '') + '> ' + esc(c.value) + (c.legalEntity ? ' <span class="muted">' + esc(c.legalEntity) + '</span>' : '') + '</label>';
        }).join('') : '<span class="sm muted">every company of the ledger</span>';
        var sync = function () { L.cos = Array.prototype.map.call(document.querySelectorAll('.tl-co:checked'), function (c) { return c.value; }); if ($('tl-all')) $('tl-all').checked = !L.cos.length; };
        document.querySelectorAll('.tl-co').forEach(function (c) { c.onchange = sync; });
        if ($('tl-all')) $('tl-all').onchange = function () { if (this.checked) { document.querySelectorAll('.tl-co').forEach(function (c) { c.checked = false; }); L.cos = []; } else this.checked = !L.cos.length; };
    };

    T.fetch = function (forceRefresh) {
        var l = T.ledgerObj(); if (!l) { FL.toast('Pick a ledger', 'err'); return; }
        var led = FL.fusion.ledgerFor(l, FL.fusion.rolesOf(L.disc));
        if (!led.company || !led.account) { FL.toast('The company / account segment of chart ' + l.coaId + ' is not set — Data › Fusion setup', 'err'); return; }
        var p = FL.fusion.progress('Trial balance ' + l.name + ' · ' + FL.fusion.calOf(L.disc, l).filter(function (x) { return x.seq === L.seq; }).map(function (x) { return x.name; })[0] + '…', true);
        $('tl-go').disabled = true;
        FL.call('finFusionTb', { pod: L.pod || '', options: { ledger: led, periodSeq: L.seq || 0, foldAdjustments: L.fold, companies: L.cos, byCostCentre: L.byCc, parallel: L.par, chunkSize: L.page, refresh: !!forceRefresh || !!($('tl-ref') && $('tl-ref').checked), queryTemplate: L.query || '', allCompanies: (l.companies || []).map(function (c) { return c.value; }) } }, 30 * 60000, p).then(function (r) {
            FL.fusion.finish();
            r.source = (r.sources && r.sources.every(function (z) { return z.from === 'pc'; }) ? 'GL balances kept on this PC' : 'Fusion') + ' · built ' + new Date().toLocaleString();
            T.listRaw(); r.pod = L.pod || ''; r.accountCol = led.account; r.companyCol = led.company; r.costCentreCol = led.costCentre;
            L.res = r;
            if (r.defaultTemplate) { L.defaultQuery = r.defaultTemplate; FL.lsSet('tbl.defaultQuery', r.defaultTemplate); if ($('tl-qtext') && !L.query) $('tl-qtext').value = r.defaultTemplate; }
            return T.fillNames(r).then(T.show);
        }).catch(function (e) { FL.fusion.finish(e && e.message || e); }).then(function () { if ($('tl-go')) $('tl-go').disabled = false; });
    };
    /** Names this PC does not have come from APEX segment values (Data › Chart of accounts › Read from Fusion fills both). */
    T.fillNames = function (r) {
        var missA = r.rows.some(function (x) { return !x.accountName; }), missC = r.rows.some(function (x) { return !x.companyName; });
        r.namesFrom = r.namesFromPc ? 'this PC' : '';
        var fill = function (col, key) {
            return FL.apexStore.loadSegValues(r.pod, r.ledger.coaId, col).then(function (v) {
                if (!v.length) return 0;
                var m = {}; v.forEach(function (x) { if (x.description) m[x.value] = x.description; });
                var n = 0; r.rows.forEach(function (x) { var code = key === 'accountName' ? x.account : x.company; if (!x[key] && m[code]) { x[key] = m[code]; n++; } });
                return n;
            }).catch(function () { return 0; });
        };
        return Promise.all([missA && r.accountCol ? fill(r.accountCol, 'accountName') : 0, missC && r.companyCol ? fill(r.companyCol, 'companyName') : 0]).then(function (n) {
            if (n[0] || n[1]) r.namesFrom = (r.namesFrom ? r.namesFrom + ' + ' : '') + 'APEX';
            if (!r.namesFrom) r.namesFrom = 'none yet — Data › Chart of accounts › Read from Fusion on the account segment';
            return r;
        });
    };

    var f2 = function (v) { return Math.abs(v) < 0.005 ? '–' : FINE.fmt(v / (L.scale || 1), 'num', { decimals: L.scale >= 1000 ? 0 : 2 }); };
    T.show = function () {
        var r = L.res, box = $('tl-res'); if (!r || !box) return;
        var cmp = null, loaded = FL.status && FL.status.loaded, code = r.ledger.code || String(r.ledger.id);
        var canCmp = loaded && (FL.dims.ledgers || []).some(function (x) { return x.code === code; }) && (FL.dims.periods || []).some(function (p) { return p.period_seq === r.period.seq; });
        var go = canCmp && L.compare ? FL.rows('SELECT company, account' + (r.byCostCentre ? ', cost_centre' : '') + ', SUM(end_bal) AS closing, SUM(period_dr) AS dr, SUM(period_cr) AS cr FROM fin_balances WHERE scenario = \'ACTUAL\' AND ledger = ' + FL.q(code) +
            ' AND period_seq = ' + r.period.seq + (r.companies && r.companies.length ? ' AND company IN (' + r.companies.map(FL.q).join(',') + ')' : '') + ' GROUP BY ALL', 500000).catch(function () { return null; }) : Promise.resolve(null);
        go.then(function (rows) {
            if (rows) { cmp = {}; rows.forEach(function (x) { cmp[x.company + '|' + x.account + (r.byCostCentre ? '|' + x.cost_centre : '')] = x; }); }
            var key = function (x) { return x.company + '|' + x.account + (r.byCostCentre ? '|' + x.costCentre : ''); };
            var lines = r.rows.map(function (x) { var c = cmp ? cmp[key(x)] : null; return Object.assign({}, x, { net: x.ptdDr - x.ptdCr, loaded: c ? c.closing : (cmp ? 0 : null) }); });
            if (cmp) { var seen = {}; lines.forEach(function (x) { seen[key(x)] = 1; }); Object.keys(cmp).forEach(function (k) { if (!seen[k] && Math.abs(cmp[k].closing) >= 0.005) { var p = k.split('|'); lines.push({ company: p[0], account: p[1], costCentre: p[2], accountName: '(only on this PC)', opening: 0, ptdDr: 0, ptdCr: 0, net: 0, qtd: 0, ytd: 0, closing: 0, loaded: cmp[k].closing }); } }); }
            // views: every line, company subtotals, by account over all companies
            if (L.view === 'account' && !r.byCostCentre && (!r.companies || r.companies.length !== 1)) {
                var g = {};
                lines.forEach(function (x) {
                    var a = g[x.account] = g[x.account] || { company: '(all)', account: x.account, accountName: x.accountName, accountType: x.accountType, opening: 0, ptdDr: 0, ptdCr: 0, net: 0, qtd: 0, ytd: 0, closing: 0, loaded: cmp ? 0 : null, n: 0 };
                    ['opening', 'ptdDr', 'ptdCr', 'net', 'qtd', 'ytd', 'closing'].forEach(function (k) { a[k] += x[k] || 0; }); if (cmp) a.loaded += x.loaded || 0; a.n++; if (!a.accountName) a.accountName = x.accountName;
                });
                lines = Object.keys(g).map(function (k) { return g[k]; });
            }
            var q = L.q.toLowerCase();
            if (q) lines = lines.filter(function (x) { return (x.company + ' ' + x.account + ' ' + (x.accountName || '') + ' ' + (x.companyName || '') + ' ' + (x.costCentre || '')).toLowerCase().indexOf(q) >= 0; });
            if (L.zero) lines = lines.filter(function (x) { return ['opening', 'ptdDr', 'ptdCr', 'closing', 'ytd'].some(function (k) { return Math.abs(x[k] || 0) >= 0.005; }) || (x.loaded && Math.abs(x.loaded) >= 0.005); });
            lines.sort(function (a, b) { return String(a.company).localeCompare(String(b.company)) || String(a.account).localeCompare(String(b.account), undefined, { numeric: true }) || String(a.costCentre || '').localeCompare(String(b.costCentre || '')); });
            var tot = { opening: 0, ptdDr: 0, ptdCr: 0, net: 0, qtd: 0, ytd: 0, closing: 0, cdr: 0, ccr: 0, loaded: 0, diff: 0, ndiff: 0 };
            lines.forEach(function (x) {
                ['opening', 'ptdDr', 'ptdCr', 'net', 'qtd', 'ytd', 'closing'].forEach(function (k) { tot[k] += x[k] || 0; });
                if (x.closing >= 0) tot.cdr += x.closing; else tot.ccr -= x.closing;
                if (cmp) { tot.loaded += x.loaded || 0; var d = (x.closing || 0) - (x.loaded || 0); x.diff = d; if (Math.abs(d) >= 0.5) tot.ndiff++; }
            });
            var withCo = L.view !== 'account' || r.byCostCentre || (r.companies && r.companies.length === 1);
            var okMove = Math.abs(tot.ptdDr - tot.ptdCr) < 1, okBal = Math.abs(tot.closing) < 1, all = !r.companies || !r.companies.length;
            var head = (withCo ? '<th>Company</th>' : '') + '<th>Account</th><th>Name</th><th>Type</th>' + (r.byCostCentre ? '<th>Cost centre</th>' : '') +
                '<th class="n">Opening</th><th class="n">PTD debits</th><th class="n">PTD credits</th><th class="n">PTD net</th><th class="n">QTD</th><th class="n">YTD</th><th class="n">Closing debit</th><th class="n">Closing credit</th>' +
                (cmp ? '<th class="n">On this PC</th><th class="n">Difference</th>' : '');
            var shown = lines.slice(0, 3000);
            T.liveLines = lines;
            box.innerHTML = '<div class="card" style="margin-top:12px"><div class="stmt-head"><h2>Trial balance — ' + esc(r.ledger.name) + '</h2><div class="sub">' + esc(r.period.name) + (r.period.folded && r.period.folded.length ? ' incl. ' + esc(r.period.folded.join(', ')) : '') +
                ' · QTD from ' + esc(r.period.quarterFrom) + ' · YTD from ' + esc(r.period.yearFrom) + ' · ' + esc(r.ledger.currency) + (all ? ' · every company' : ' · companies ' + esc(r.companies.join(', '))) + ' · ' + esc(r.source) + '</div></div>' +
                '<div class="row" style="margin:6px 0 10px"><span class="tag ' + (okMove ? 'good' : 'bad') + '">' + (okMove ? '✓ PTD debits = credits' : '✗ PTD debits ≠ credits: ' + f2(tot.ptdDr - tot.ptdCr)) + '</span>' +
                (all ? '<span class="tag ' + (okBal ? 'good' : 'bad') + '">' + (okBal ? '✓ closing balances net to nil' : '✗ closing balances net to ' + f2(tot.closing)) + '</span>' : '') +
                (cmp ? '<span class="tag ' + (tot.ndiff ? 'bad' : 'good') + '">' + (tot.ndiff ? '✗ ' + tot.ndiff + ' line(s) differ from this PC' : '✓ same as the data on this PC') + '</span>' : canCmp ? '' : (loaded ? '<span class="sm muted">this ledger / period is not loaded on this PC — no comparison</span>' : '')) +
                '<span class="sm muted">' + r.rows.length.toLocaleString() + ' lines' + (r.ms ? ' in ' + (r.ms / 1000).toFixed(1) + ' s' : '') + (r.sources ? ' · ' + r.sources.map(function (x) { return x.period + (x.from === 'pc' ? ' from this PC (read ' + x.at + ')' : ' read from Fusion now') + ', ' + (+x.rows).toLocaleString() + ' rows'; }).join(' · ') : '') + ' · names: ' + esc(r.namesFrom || '') + '</span>' + (/^none/.test(r.namesFrom || '') && r.accountCol ? '<button class="btn sm" id="tl-names"><i class="fa-solid fa-tags"></i> Read the account names from Fusion</button>' : '') + '</div>' +
                '<div class="row toolbar" style="margin-bottom:8px"><input id="tl-q" placeholder="Search account, name, company" value="' + esc(L.q) + '" style="min-width:200px">' +
                '<label class="sm">Show <select id="tl-view">' + [['account', 'by account (companies added up)'], ['line', 'every company × account']].map(function (x) { return '<option value="' + x[0] + '"' + (L.view === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></label>' +
                '<label class="sm">Amounts <select id="tl-scale">' + [[1, 'units'], [1000, 'thousands'], [1000000, 'millions']].map(function (x) { return '<option value="' + x[0] + '"' + (L.scale === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></label>' +
                '<label class="sm"><input type="checkbox" id="tl-zero"' + (L.zero ? ' checked' : '') + '> hide empty</label>' + (canCmp ? '<label class="sm"><input type="checkbox" id="tl-cmp"' + (L.compare ? ' checked' : '') + '> compare with this PC</label>' : '') +
                '<span class="grow"></span><button class="btn sm" id="tl-duck"><i class="fa-solid fa-database"></i> Save to DuckDB</button><button class="btn sm" id="tl-apex"><i class="fa-solid fa-cloud-arrow-up"></i> Save to APEX</button>' +
                '<button class="btn sm" id="tl-xl"><i class="fa-solid fa-file-excel"></i> Excel</button><button class="btn sm" id="tl-csv"><i class="fa-solid fa-file-csv"></i> CSV</button><span class="sm muted" id="tl-saved-msg"></span></div>' +
                '<div class="scroll" style="max-height:62vh"><table class="t tb"><thead><tr>' + head + '</tr></thead><tbody>' + shown.map(function (x, i) {
                    var bad = cmp && Math.abs(x.diff || 0) >= 0.5;
                    return '<tr class="click' + (bad ? ' warnrow' : '') + '" data-i="' + i + '">' + (withCo ? '<td title="' + esc(x.companyName || '') + '">' + esc(x.company) + '</td>' : '') + '<td class="mono">' + esc(x.account) + '</td><td>' + esc(x.accountName || '') + '</td><td>' + esc(TYPE[x.accountType] || x.accountType || '') + '</td>' +
                        (r.byCostCentre ? '<td>' + esc(x.costCentre || '') + '</td>' : '') +
                        '<td class="n">' + f2(x.opening) + '</td><td class="n">' + f2(x.ptdDr) + '</td><td class="n">' + f2(x.ptdCr) + '</td><td class="n">' + f2(x.net) + '</td><td class="n">' + f2(x.qtd) + '</td><td class="n">' + f2(x.ytd) + '</td>' +
                        '<td class="n">' + (x.closing > 0.005 ? f2(x.closing) : '') + '</td><td class="n">' + (x.closing < -0.005 ? f2(-x.closing) : '') + '</td>' +
                        (cmp ? '<td class="n">' + f2(x.loaded || 0) + '</td><td class="n ' + (bad ? 'neg' : '') + '">' + f2(x.diff || 0) + '</td>' : '') + '</tr>';
                }).join('') + '</tbody><tfoot><tr><td colspan="' + ((withCo ? 1 : 0) + 3 + (r.byCostCentre ? 1 : 0)) + '"><b>Total</b></td>' + ['opening', 'ptdDr', 'ptdCr', 'net', 'qtd', 'ytd'].map(function (k) { return '<td class="n"><b>' + f2(tot[k]) + '</b></td>'; }).join('') +
                '<td class="n"><b>' + f2(tot.cdr) + '</b></td><td class="n"><b>' + f2(tot.ccr) + '</b></td>' + (cmp ? '<td class="n"><b>' + f2(tot.loaded) + '</b></td><td class="n"><b>' + f2(tot.closing - tot.loaded) + '</b></td>' : '') + '</tr></tfoot></table></div>' +
                (lines.length > shown.length ? '<p class="sm muted">First 3,000 of ' + lines.length.toLocaleString() + ' lines — search to narrow; Excel / CSV hold them all.</p>' : '') +
                '<p class="sm muted">Opening = balance at the start of the period · PTD = this period' + (r.period.folded && r.period.folded.length ? ' with its adjustment period' : '') + ' · QTD / YTD = closing − the balance at the start of the quarter / fiscal year (income statement accounts start the year at nil) · click a line for the account across companies.</p></div>';
            $('tl-q').oninput = function () { L.q = this.value; clearTimeout(L.t); L.t = setTimeout(function () { T.show(); setTimeout(function () { var i = $('tl-q'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 0); }, 250); };
            $('tl-view').onchange = function () { L.view = this.value; FL.lsSet('tbl.view', L.view); T.show(); };
            $('tl-scale').onchange = function () { L.scale = +this.value; FL.lsSet('tbl.scale', L.scale); T.show(); };
            $('tl-zero').onchange = function () { L.zero = this.checked; T.show(); };
            if ($('tl-cmp')) $('tl-cmp').onchange = function () { L.compare = this.checked; FL.lsSet('tbl.compare', L.compare); T.show(); };
            $('tl-csv').onclick = function () { T.liveCsv(r); };
            $('tl-xl').onclick = function () { T.liveExcel(r, withCo); };
            $('tl-duck').onclick = function () { T.saveDuck(r, this); };
            if ($('tl-names')) $('tl-names').onclick = function () { T.readNames(r, this); };
            $('tl-apex').onclick = function () { T.saveApex(r, this); };
            FL.wireRows(box, shown, function (x) { T.accountAcross(r, x.account); });
        });
    };

    /** One read of the account segment's values (value set descriptions) — kept on this PC / DuckDB and in APEX for every later trial balance */
    T.readNames = function (r, btn) {
        btn.disabled = true;
        var p = FL.fusion.progress('Reading the names of ' + r.accountCol + '…', true);
        FL.call('finFusionSegValues', { pod: r.pod || '', coaId: r.ledger.coaId, column: r.accountCol }, 20 * 60000, p).then(function (x) {
            FL.fusion.finish();
            var m = {}; x.values.forEach(function (v) { if (v.description) m[v.value] = v.description; });
            r.rows.forEach(function (row) { if (!row.accountName && m[row.account]) row.accountName = m[row.account]; });
            r.namesFrom = 'Fusion value set (now kept ' + (x.savedDuck ? 'in DuckDB' : 'on this PC') + ' and in APEX)';
            T.show();
            return FL.apexStore.saveSegValues(r.pod || '', r.ledger.coaId, r.accountCol, x.values).catch(function (e) { FL.toast('APEX: ' + (e.message || e), 'err'); });
        }).catch(function (e) { FL.fusion.finish(e && e.message || e); btn.disabled = false; });
    };

    T.accountAcross = function (r, acct) {
        var rows = r.rows.filter(function (x) { return x.account === acct; }), name = (rows[0] || {}).accountName || '';
        FL.modal('<i class="fa-solid fa-scale-balanced"></i> ' + esc(acct + ' ' + name), '<p class="sm muted">' + esc(r.ledger.name + ' · ' + r.period.name) + ' · every company' + (r.byCostCentre ? ' and cost centre' : '') + '</p>' +
            FL.table([{ label: 'Company', get: function (x) { return x.company + (x.companyName ? ' ' + x.companyName : ''); } }].concat(r.byCostCentre ? [{ label: 'Cost centre', key: 'costCentre' }] : []).concat([
                { label: 'Opening', n: 1, get: function (x) { return f2(x.opening); } }, { label: 'PTD debits', n: 1, get: function (x) { return f2(x.ptdDr); } }, { label: 'PTD credits', n: 1, get: function (x) { return f2(x.ptdCr); } },
                { label: 'YTD', n: 1, get: function (x) { return f2(x.ytd); } }, { label: 'Closing', n: 1, get: function (x) { return f2(x.closing); } }]), rows));
    };

    var COLS = ['company', 'company_name', 'account', 'account_name', 'account_type', 'cost_centre', 'opening', 'ptd_debits', 'ptd_credits', 'ptd_net', 'qtd', 'ytd', 'closing'];
    var rowOf = function (x) { return [x.company, x.companyName || '', x.account, x.accountName || '', x.accountType || '', x.costCentre || '', x.opening, x.ptdDr, x.ptdCr, x.ptdDr - x.ptdCr, x.qtd, x.ytd, x.closing]; };
    T.liveCsv = function (r) { FL.csv('trial-balance-' + (r.ledger.code || r.ledger.id) + '-' + r.period.name + '.csv', COLS, r.rows.map(function (x) { return rowOf(x).map(function (v) { return typeof v === 'number' ? v.toFixed(2) : v; }); })); };
    T.liveExcel = function (r) {
        if (!window.ExcelJS) { FL.toast('Excel library did not load (internet?)', 'err'); return; }
        var wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Trial balance');
        ws.addRow(['Trial balance — ' + r.ledger.name]).font = { bold: true, size: 14, color: { argb: 'FF0B2545' } };
        ws.addRow([r.period.name + ' · ' + r.ledger.currency + ' · ' + r.source]).font = { italic: true, color: { argb: 'FF64748B' } };
        ws.addRow([]);
        var hr = ws.addRow(['Company', 'Company name', 'Account', 'Account name', 'Type', 'Cost centre', 'Opening', 'PTD debits', 'PTD credits', 'PTD net', 'QTD', 'YTD', 'Closing']);
        hr.font = { bold: true, color: { argb: 'FFFFFFFF' } }; hr.eachCell(function (c) { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF13315C' } }; });
        var start = ws.rowCount + 1;
        r.rows.forEach(function (x) { ws.addRow(rowOf(x)); });
        var end = ws.rowCount, tr = ws.addRow(['Total', '', '', '', '', ''].concat(['G', 'H', 'I', 'J', 'K', 'L', 'M'].map(function (c) { return { formula: 'SUM(' + c + start + ':' + c + end + ')' }; })));
        tr.font = { bold: true };
        for (var i = 7; i <= 13; i++) { ws.getColumn(i).numFmt = '#,##0.00;(#,##0.00);"–"'; ws.getColumn(i).width = 16; }
        ws.getColumn(4).width = 40; ws.getColumn(2).width = 28;
        ws.views = [{ state: 'frozen', ySplit: 4 }];
        wb.xlsx.writeBuffer().then(function (buf) { FL.download('trial-balance-' + (r.ledger.code || r.ledger.id) + '-' + r.period.name + '.xlsx', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); });
    };
    var payload = function (r) { return { pod: r.pod || '', ledger: { code: r.ledger.code || String(r.ledger.id), name: r.ledger.name, currency: r.ledger.currency }, period: { seq: r.period.seq, name: r.period.name }, rows: r.rows }; };
    T.saveDuck = function (r, btn) {
        btn.disabled = true;
        FL.call('finTbSave', payload(r), 120000).then(function (x) { $('tl-saved-msg').textContent = '✓ ' + x.rows.toLocaleString() + ' lines saved in DuckDB (fin_tb_live)'; T.listSaved(); })
            .catch(function (e) { FL.toast('DuckDB: ' + e, 'err'); }).then(function () { btn.disabled = false; });
    };
    T.saveApex = function (r, btn) {
        btn.disabled = true;
        var msg = $('tl-saved-msg');
        FL.apexStore.saveTb(r.pod || '', payload(r), function (i, n) { msg.textContent = 'APEX ' + i.toLocaleString() + ' / ' + n.toLocaleString() + '…'; })
            .then(function () { msg.textContent = '✓ ' + r.rows.length.toLocaleString() + ' lines saved in APEX (WMS_FIN_TB_LIVE)'; T.listSaved(); })
            .catch(function (e) { msg.textContent = ''; FL.toast('APEX: ' + (e.message || e), 'err'); }).then(function () { btn.disabled = false; });
    };

    /** Saved trial balances: this PC's DuckDB (fin_tb_live) and APEX (WMS_FIN_TB_LIVE) */
    T.listSaved = function () {
        var box = $('tl-saved'); if (!box) return;
        T.listRaw();
        var duck = FL.call('finQuery', { sql: "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_name = 'fin_tb_live'", maxRows: 1 }).then(function (d) {
            if (!d.rows.length || !d.rows[0][0]) return [];
            return FL.call('finQuery', { sql: 'SELECT pod, ledger, MAX(ledger_name), MAX(currency), period_seq, MAX(period_name), COUNT(*), CAST(MAX(fetched_at) AS VARCHAR), MAX(fetched_by) FROM fin_tb_live GROUP BY pod, ledger, period_seq ORDER BY MAX(fetched_at) DESC', maxRows: 200 })
                .then(function (q) { return q.rows.map(function (x) { return { pod: x[0], code: x[1], name: x[2], currency: x[3], seq: x[4], period: x[5], lines: x[6], at: String(x[7] || '').slice(0, 16), by: x[8], where: 'DuckDB' }; }); });
        }).catch(function () { return []; });
        var apex = FL.apexStore.listTb().catch(function () { return []; });
        Promise.all([duck, apex]).then(function (r) {
            var list = r[0].concat(r[1]);
            if (!$('tl-saved')) return;
            if (!list.length) { box.innerHTML = '<p class="sm muted">None yet — fetch one and press Save to DuckDB / Save to APEX.</p>'; return; }
            T.savedList = list;
            box.innerHTML = '<div class="scroll" style="max-height:260px">' + FL.table([{ label: 'Kept in', key: 'where' }, { label: 'Pod', get: function (x) { return x.pod || 'logged-in'; } }, { label: 'Ledger', get: function (x) { return x.name || x.code; } },
                { label: 'Period', key: 'period' }, { label: 'Lines', n: 1, get: function (x) { return (+x.lines).toLocaleString(); } }, { label: 'Saved', get: function (x) { return x.at + (x.by ? ' · ' + x.by : ''); } }], list, { click: true }) + '</div>';
            FL.wireRows(box, list, T.openSaved);
        });
    };
    T.listRaw = function () {
        var box = $('tl-raw'); if (!box) return;
        FL.call('finQuery', { sql: "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_name = 'fin_gl_balances_sync'", maxRows: 1 }).then(function (d) {
            if (!d.rows.length || !d.rows[0][0]) return [];
            return FL.call('finQuery', { sql: "SELECT s.pod, s.ledger_id, s.period_name, s.currency, s.rows_read, s.ms, CAST(s.fetched_at AS VARCHAR), s.columns_read FROM fin_gl_balances_sync s ORDER BY s.fetched_at DESC", maxRows: 500 }).then(function (q) { return q.rows; });
        }).catch(function () { return []; }).then(function (rows) {
            if (!$('tl-raw')) return;
            var leds = {}; ((L.disc && L.disc.ledgers) || []).forEach(function (l) { leds[String(l.id)] = l.name; });
            box.innerHTML = rows.length ? '<div class="scroll" style="max-height:220px">' + FL.table([{ label: 'Pod', get: function (x) { return x[0] || 'logged-in'; } }, { label: 'Ledger', get: function (x) { return leds[String(x[1])] || x[1]; } },
                { label: 'Period', get: function (x) { return x[2]; } }, { label: 'Currency', get: function (x) { return x[3]; } }, { label: 'Rows', n: 1, get: function (x) { return (+x[4]).toLocaleString(); } }, { label: 'Columns', n: 1, get: function (x) { return x[7]; } },
                { label: 'Read in', n: 1, get: function (x) { return ((+x[5] || 0) / 1000).toFixed(1) + ' s'; } }, { label: 'Read at', get: function (x) { return String(x[6] || '').slice(0, 16); } }], rows) + '</div>' +
                '<p class="sm muted">Query them in Data › SQL explorer: <code>fin_gl_balances</code> (every GL_BALANCES column) joined to <code>fin_ccid</code> on code_combination_id = ccid (segments of every code combination read so far).</p>'
                : '<p class="sm muted">None yet — the first trial balance of a ledger and period reads its GL_BALANCES rows from Fusion and keeps them here.</p>';
        });
    };
    T.openSaved = function (x) {
        var rows = x.where === 'APEX' ? FL.apexStore.loadTb(x.pod, x.code, x.seq)
            : FL.call('finQuery', { sql: 'SELECT company, account, cost_centre, account_type, account_name, opening, ptd_dr, ptd_cr, closing, qtr_open, year_open FROM fin_tb_live WHERE pod = ' + FL.q(x.pod) + ' AND ledger = ' + FL.q(x.code) + ' AND period_seq = ' + (+x.seq), maxRows: 500000 })
                .then(function (q) { return q.rows.map(function (v) { return { company: v[0], account: v[1], costCentre: v[2], accountType: v[3], accountName: v[4], opening: v[5], ptdDr: v[6], ptdCr: v[7], closing: v[8], qtrOpen: v[9], yearOpen: v[10] }; }); });
        rows.then(function (list) {
            list.forEach(function (v) { v.qtd = v.closing - v.qtrOpen; v.ytd = v.closing - v.yearOpen; });
            L.res = { ledger: { code: x.code, name: x.name || x.code, currency: x.currency }, period: { seq: +x.seq, name: x.period, folded: [], quarterFrom: '…', yearFrom: '…' }, rows: list, pod: x.pod,
                byCostCentre: list.some(function (v) { return v.costCentre; }), companies: [], source: 'saved in ' + x.where + ' ' + x.at, namesFrom: 'saved with it' };
            T.show();
            var el = $('tl-res'); if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }).catch(function (e) { FL.toast(String(e), 'err'); });
    };
})();
