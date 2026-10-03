/* Finance Lens — Data › Trial balance sync: one ledger, a range of periods, read from Fusion grouped by company × account
   (× cost centre) — GL_BALANCES joined to GL_CODE_COMBINATIONS, SUM of the balance columns, one query per company and period,
   zero / summary rows skipped — and kept on this PC (DuckDB fin_gl_balances_acct). Every sync rebuilds the statements data from
   all synced periods (fin_balances …, source FUSION_TB) unless a full SQL / BICC load is on this PC, so Statements, Analytics and
   KPIs work on exactly the synced periods. The year board shows one tile per period (✓ synced, n/m companies, ✗ not synced,
   live while syncing); tick tiles and Sync / Remove them. Settings (companies, options, query) are folded away. Host: finTbSync, finTbSyncStatus, finTbSyncDelete (classes/FinanceFusion.cs SyncTbAsync,
   FinanceLens.BuildFromTb). */
(function () {
    var T = FL.tbsync = {};
    var L = T.st = { pod: FL.ls('tbl.pod', null), ledger: FL.ls('tbl.ledger', null), year: FL.ls('tbl.year', null), cos: [], byCc: FL.ls('tbl.byCc', false), fold: true, par: FL.ls('tbl.par', 2),
        opt: Object.assign({ skipZero: true, allSums: false, hint: true, perCompany: true }, FL.ls('tbl.opt', {})), query: '', defaultQuery: '', sel: {}, status: null, extBy: FL.ls('tbl.extBy', 'auto'), extBatch: FL.ls('tbl.extBatch', 1) };
    T.qKey = function () { return 'account' + (L.byCc ? '.cc' : '') + '.' + (L.opt.skipZero ? 'z' : '') + (L.opt.allSums ? 'a' : '') + (L.opt.hint ? 'h' : ''); };
    T.loadQ = function () { L.query = FL.ls('tbl.query.account', ''); L.defaultQuery = FL.ls('tbl.dq.' + T.qKey(), ''); };
    T.loadQ();

    T.render = function (el) {
        var s = FL.fusion.saved() || {}, admin = FL.who && FL.who.admin;
        if (L.pod == null) L.pod = (s.setup && s.setup.pod) || s.pod || '';
        var running = T.live && T.live.running;
        el.innerHTML = '<div class="card ts-main"><div class="row"><h3 style="margin:0"><i class="fa-solid fa-scale-balanced"></i> Trial balance sync</h3>' +
            '<span class="sm muted">pick a ledger and a year, tick the periods, press Sync — Statements use what is synced</span></div>' +
            (admin ? '' : '<div class="callout warn sm" style="margin-top:8px">An AI admin syncs the finance data on this PC.</div>') +
            '<div class="row" style="margin-top:10px"><label class="sm">Pod <select id="ts-pod"><option value="">Logged-in pod</option><option value="PROD"' + (L.pod === 'PROD' ? ' selected' : '') + '>PROD</option><option value="TEST"' + (L.pod === 'TEST' ? ' selected' : '') + '>TEST</option></select></label>' +
            '<label class="sm">Ledger <select id="ts-led"><option>…</option></select></label><div class="seg" id="ts-years"></div></div>' +
            '<div id="ts-board" class="ts-board"><div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i></div></div>' +
            '<div class="row ts-acts"><button class="btn sm" id="ts-selmiss"><i class="fa-regular fa-square-check"></i> Select not synced</button><button class="btn sm" id="ts-selall">Select all</button><button class="btn sm" id="ts-selnone">Clear</button>' +
            '<span class="grow"></span>' + T.actBtns('ts') +
            '<button class="btn" id="ts-open"><i class="fa-solid fa-arrow-right"></i> Trial balance</button></div>' +
            '<div id="ts-live"></div>' +
            '<details class="ts-det" id="ts-det"' + (FL.ls('tbl.det', false) ? ' open' : '') + '><summary class="sm"><i class="fa-solid fa-list-check"></i> Details — every query, its SQL, sample rows and the log</summary><div id="fu-prog"></div></details></div>' +
            '<details class="card ts-set" id="ts-set" style="margin-top:12px"' + (FL.ls('tbl.setOpen', false) ? ' open' : '') + '><summary><b><i class="fa-solid fa-sliders"></i> Settings</b> <span class="sm muted" id="ts-setsum"></span></summary>' +
            '<div class="row" style="margin-top:8px"><span class="sm muted">Companies</span><div id="ts-cos" class="tl-cos"></div></div>' +
            '<div class="row" style="margin-top:6px"><label class="sm"><input type="checkbox" id="ts-cc"' + (L.byCc ? ' checked' : '') + '> by cost centre</label>' +
            '<label class="sm"><input type="checkbox" id="ts-fold"' + (L.fold ? ' checked' : '') + ' title="Adjustment periods (e.g. Adj-25) are read too and added to the period they close"> fold adjustment periods</label>' +
            '<label class="sm" title="Queries to Fusion at the same time (one per company and period)">Reads in parallel <select id="ts-par">' + [1, 2, 3, 4].map(function (n) { return '<option' + (L.par === n ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label></div>' +
            '<div class="ts-ext" id="ts-ext"></div>' +
            '<details class="tl-q" id="tl-qbox"' + (L.query ? ' open' : '') + '><summary><b><i class="fa-solid fa-code"></i> GL_BALANCES query</b> <span class="sm muted" id="tl-qstate">' + (L.query ? 'your own query' : 'default') + '</span></summary>' +
            '<p class="sm muted">One query per company and period. <code>{LEDGER_ID}</code>, <code>{PERIOD}</code>, <code>{CURRENCY}</code>, <code>{COMPANY_SEGMENT}</code>, <code>{ACCOUNT_SEGMENT}</code>, <code>{COST_CENTRE_SEGMENT}</code> and ' +
            '<code>{COMPANY_FILTER}</code> (<code>AND c.SEGMENTn = \'01\'</code>) are filled in. It must return COMPANY, ACCOUNT, BEGIN_BALANCE_DR, BEGIN_BALANCE_CR, PERIOD_NET_DR and PERIOD_NET_CR (ACCOUNT_TYPE and COST_CENTRE when it has them); ' +
            'it is read in one go — no ROWNUM / ROW_NUMBER. A query pasted with real values gets its placeholders back.</p>' +
            '<div class="row sm" id="tl-qopts">' +
            [['skipZero', 'skip zero & summary rows', 'Leaves out rows with no opening balance and no movement, and summary-template rows, while GL_BALANCES is scanned — before the join and the grouping. They add nothing to a trial balance.'],
             ['allSums', 'all balance columns', 'SUM() every _DR / _CR / _ADB (_BEQ) column, not only the four a trial balance needs — slower'],
             ['perCompany', 'one query per company', 'One query per company and period (c.SEGMENTn = \'01\'), Reads in parallel at a time; companies already on this PC are not read again'],
             ['hint', 'optimizer hint', 'LEADING(b) USE_HASH(c) PARALLEL(4): scan GL_BALANCES first, hash join to GL_CODE_COMBINATIONS, in parallel']].map(function (x) {
                return '<label title="' + esc(x[2]) + '"><input type="checkbox" data-o="' + x[0] + '"' + (L.opt[x[0]] ? ' checked' : '') + '> ' + x[1] + '</label>'; }).join('') + '</div>' +
            '<textarea id="tl-qtext" spellcheck="false" rows="7">' + esc(L.query || L.defaultQuery || T.defaultQ()) + '</textarea>' +
            '<div class="row"><button class="btn sm" id="ts-test" title="Runs this query in Fusion now for the first selected period (or the latest) and the first company — rows, time and the first rows"><i class="fa-solid fa-play"></i> Test query</button>' +
            '<button class="btn sm" id="tl-qreset"><i class="fa-solid fa-rotate-left"></i> Default query</button><div id="tl-qfix"></div>' +
            '<span class="sm muted">Sync uses this query; your own query is kept on this PC.</span></div><div id="ts-testres"></div></details></details>' +
            '<div class="card" style="margin-top:12px" id="ts-md"></div>';
        FL.fusion.paint();
        T.paintLive();
        $('ts-det').ontoggle = function () { FL.lsSet('tbl.det', this.open); if (this.open) FL.fusion.paint(); };
        $('ts-set').ontoggle = function () { FL.lsSet('tbl.setOpen', this.open); };
        $('ts-pod').onchange = function () { L.pod = this.value; FL.lsSet('tbl.pod', L.pod); L.ledger = null; L.sel = {}; T.fillLedgers(); };
        $('ts-cc').onchange = function () { L.byCc = this.checked; FL.lsSet('tbl.byCc', L.byCc); T.loadQ(); if (!L.query) $('tl-qtext').value = L.defaultQuery || T.defaultQ(); T.setSum(); };
        $('ts-fold').onchange = function () { L.fold = this.checked; T.setSum(); };
        $('ts-par').onchange = function () { L.par = +this.value; FL.lsSet('tbl.par', L.par); T.setSum(); };
        T.wireActs('ts');
        $('ts-open').onclick = function () { FL.stmt.tpl = 'TB'; FL.lsSet('stmt.tpl', 'TB'); FL.show('statements'); };
        $('ts-selmiss').onclick = function () { T.select('missing'); };
        $('ts-selall').onclick = function () { T.select('all'); };
        $('ts-selnone').onclick = function () { T.select('none'); };
        $('tl-qtext').oninput = function () { T.qCheck(false); };
        $('ts-test').onclick = function () { T.test(); };
        [].forEach.call(document.querySelectorAll('#tl-qopts input'), function (cb) {
            cb.onchange = function () {
                L.opt[cb.dataset.o] = cb.checked; FL.lsSet('tbl.opt', L.opt); T.setSum();
                if (cb.dataset.o === 'perCompany') return;   // how the query is run, not the query
                var q = L.query; T.loadQ(); L.query = q;
                if (!L.query) { $('tl-qtext').value = L.defaultQuery || T.defaultQ(); T.qCheck(false); }
                else FL.toast('Your own query is used — press Default query to get the default with these options', 'info');
            };
        });
        $('tl-qreset').onclick = function () { L.query = ''; FL.lsSet('tbl.query.account', ''); $('tl-qtext').value = L.defaultQuery || T.defaultQ(); $('tl-qstate').textContent = 'default'; T.qCheck(false); };
        T.qCheck(false);
        T.fillLedgers();
        if (running) $('ts-go').disabled = true;
    };

    /** The query with this ledger's values for one period and company (what Sync sends for that read) */
    T.fill = function (q, period, company) {
        var l = T.ledgerObj(), led = l ? FL.fusion.ledgerFor(l, FL.fusion.rolesOf(L.disc)) : {};
        var sq = function (v) { return String(v == null ? '' : v).replace(/'/g, "''"); };
        return q.replace(/\{LEDGER_ID\}/g, l ? l.id : '').replace(/\{PERIOD\}/g, sq(period)).replace(/\{CURRENCY\}/g, sq(l && l.currency))
            .replace(/\{COMPANY_FILTER\}/g, company ? ' AND c.' + led.company + " = '" + sq(company) + "'" : '')
            .replace(/\{COMPANY_SEGMENT\}/g, led.company || '').replace(/\{ACCOUNT_SEGMENT\}/g, led.account || '').replace(/\{COST_CENTRE_SEGMENT\}/g, led.costCentre || led.account || '');
    };
    /** Test query: the To period, the first ticked company (or the ledger's first) — straight to Fusion, rows / time / first rows */
    T.test = function () {
        var l = T.ledgerObj(); if (!l) { FL.toast('Pick a ledger', 'err'); return; }
        var cal = T.cal(), sel = T.selSeqs(), per = cal.filter(function (p) { return p.seq === sel[0]; })[0] || T.latest(); if (!per) return;
        var co = L.cos[0] || ((l.companies || [])[0] || {}).value;
        var sql = T.fill($('tl-qtext').value.trim(), per.name, co);
        $('ts-testres').innerHTML = '<div class="sm muted" style="margin-top:6px">' + esc(per.name + (co ? ' · company ' + co : '')) + '</div><div class="fu-runres"></div><pre class="mon-sql">' + esc(sql) + '</pre>';
        FL.fusion.runSql(sql, L.pod || '', $('ts-testres').querySelector('.fu-runres'));
    };

    // ── master data checklist: what the trial balance and the statements need besides the balances, with its status and a sync button ──
    T.md = function () {
        var boxes = T.pfx().map(function (x) { return $(x + '-md'); }).filter(Boolean); if (!boxes.length) return;
        var l = T.ledgerObj();
        if (!l) { boxes.forEach(function (b) { b.innerHTML = '<h3 style="margin:0"><i class="fa-solid fa-list-check"></i> Master data</h3><p class="sm muted">Pick a ledger (Fusion setup › Discover first).</p>'; }); return; }
        var led = FL.fusion.ledgerFor(l, FL.fusion.rolesOf(L.disc)), coa = l.coaId, st = FL.status || {};
        var segs = [['co', 'Company values & names', led.company, false], ['ac', 'Account values, names & types', led.account, true]];
        if (led.costCentre) segs.push(['cc', 'Cost centre values & names', led.costCentre, false]);
        T.extCols().forEach(function (col) { if (col !== led.company && col !== led.account && col !== led.costCentre) segs.push(['x' + col, T.segName(col).replace(/ \(SEGMENT\d+\)$/, '') + ' values & names', col, false]); });
        var reads = segs.map(function (g) {
            return FL.call('finSegValues', { coaId: coa, column: g[2] }).then(function (r) { return r; }).catch(function () { return { values: [] }; });
        });
        var cls = st.loaded ? FL.rows('SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE class IS NULL OR class = \'\') AS nocls, COUNT(*) FILTER (WHERE account_type IS NULL) AS notype, COUNT(*) FILTER (WHERE name IS NULL OR name = code) AS noname FROM fin_accounts', 1).then(function (r) { return r[0]; }).catch(function () { return null; }) : Promise.resolve(null);
        var bud = st.loaded ? FL.rows("SELECT COUNT(*) AS n FROM fin_balances WHERE scenario = 'BUDGET'", 1).then(function (r) { return r[0].n; }).catch(function () { return 0; }) : Promise.resolve(0);
        Promise.all(reads.concat([bud, cls])).then(function (res) {
            var acc = res[res.length - 1], nBud = res[res.length - 2], cells = T.cells(), nSync = Object.keys(cells).length, cal = T.cal();
            var items = [
                { k: 'ledgers', label: 'Ledgers & calendar', ok: !!L.disc, info: (L.disc ? (L.disc.ledgers || []).length + ' ledger(s) · ' + cal.length + ' periods in ' + l.name + "'s calendar" : 'not discovered'), act: '<button class="btn sm" data-md="setup">Fusion setup</button>' },
                { k: 'roles', label: 'Segment roles', ok: !!(led.company && led.account), info: 'company ' + (led.company || '?') + ' · account ' + (led.account || '?') + ' · cost centre ' + (led.costCentre || 'none'), act: '<button class="btn sm" data-md="setup">Change</button>' }
            ];
            segs.forEach(function (g, i) {
                var r = res[i] || {}, v = r.values || [], named = v.filter(function (x) { return x.description; }).length, typed = v.filter(function (x) { return x.accountType; }).length;
                var ok = v.length > 0 && named >= v.length * 0.9 && (!g[3] || typed >= v.length * 0.9);
                items.push({ k: g[0], col: g[2], label: g[1] + ' (' + g[2] + ')', ok: ok, part: v.length > 0 && !ok,
                    info: v.length ? v.length.toLocaleString() + ' values · ' + named.toLocaleString() + ' named' + (g[3] ? ' · ' + typed.toLocaleString() + ' typed' : '') + ' · read ' + String(v[0].fetchedAt || '').slice(0, 16) + (r.source === 'pending' ? ' (waiting for the first load)' : '') : 'not read yet — the trial balance shows codes' + (g[3] ? ' and type ?' : ''),
                    act: '<button class="btn sm" data-md="apex" data-col="' + esc(g[2]) + '" title="Use the values kept in APEX">From APEX</button><button class="btn sm' + (ok ? '' : ' primary') + '" data-md="fusion" data-col="' + esc(g[2]) + '" title="Read every value with its description' + (g[3] ? ' and account type' : '') + ' from Fusion (one query over the code combinations; kept on this PC and in APEX)"><i class="fa-solid fa-cloud-arrow-down"></i> ' + (v.length ? 'Sync again' : 'Sync') + '</button>' });
            });
            if (acc) items.push({ k: 'cls', label: 'Account classes (statement lines)', ok: !acc.nocls, part: acc.nocls && acc.nocls < acc.n,
                info: acc.n.toLocaleString() + ' accounts · ' + (acc.n - acc.nocls).toLocaleString() + ' with a class' + (acc.notype ? ' · ' + acc.notype + ' without a type' : '') + (acc.noname ? ' · ' + acc.noname + ' without a name' : ''),
                act: '<button class="btn sm" data-md="mapping">Account mapping</button>' });
            items.push({ k: 'tb', label: 'Trial balance periods', ok: nSync > 0, info: nSync ? nSync + ' period(s) of ' + l.name + ' synced' : 'none yet — tick periods on the board and press Sync', act: '' });
            // extended segments: the synced trial balance periods must also have the balances by the chosen extra segments (fin_gl_balances_ext)
            var ext = T.extCols(), want0 = T.want(), extMiss = Object.keys(cells).map(Number).filter(function (q) { return T.extState(q, want0) !== 'done'; }).sort();
            var extNames = ext.map(T.segName);
            items.push({ k: 'ext', adm: true, label: 'Extended segments' + (ext.length ? ' — ' + extNames.join(', ') : ''), ok: ext.length > 0 && nSync > 0 && !extMiss.length, part: ext.length > 0 && extMiss.length > 0 && extMiss.length < nSync,
                info: !ext.length ? 'none chosen — pick the extra segments (cost centre, analysis, salesperson …) to report balances by them (table fin_gl_balances_ext)'
                    : !nSync ? 'sync trial balance periods first' : extMiss.length ? extMiss.length + ' of ' + nSync + ' synced period(s) still without the extended balances' : 'all ' + nSync + ' synced period(s) have balances by ' + extNames.join(' × ') + ' — query fin_gl_ext_v',
                act: '<button class="btn sm" data-md="extpick">' + (ext.length ? 'Change' : 'Choose segments') + '</button>' + (ext.length && extMiss.length ? '<button class="btn sm primary" data-md="extsync" data-seqs="' + extMiss.join(',') + '"><i class="fa-solid fa-cloud-arrow-down"></i> Sync ' + extMiss.length + ' period(s)</button>' : '') });
            // what the KPIs and the company health need besides the current months
            var seqsOn = Object.keys(cells).map(Number), latest = seqsOn.length ? Math.max.apply(null, seqsOn) : null, lp = cal.filter(function (p) { return p.seq === latest; })[0];
            var syncBtn = function (k, list, label) { return list.length ? '<button class="btn sm primary" data-md="seqs" data-seqs="' + list.join(',') + '" title="' + esc(list.length + ' period(s): ' + cal.filter(function (p) { return list.indexOf(p.seq) >= 0; }).map(function (p) { return p.name; }).join(', ')) + '"><i class="fa-solid fa-cloud-arrow-down"></i> ' + esc(label) + '</button>' : ''; };
            if (lp) {
                var last12 = cal.filter(function (p) { return p.seq <= latest; }).sort(function (a, b) { return a.seq - b.seq; }).slice(-12), miss12 = last12.filter(function (p) { return !cells[p.seq]; }).map(function (p) { return p.seq; });
                items.push({ k: 'ltm', adm: true, label: '12 months in a row (last-12-month KPIs: DSO, ROE, interest cover …)', ok: last12.length >= 12 && !miss12.length, part: miss12.length > 0 && miss12.length < last12.length,
                    info: last12.length < 12 ? 'the calendar has only ' + last12.length + ' months up to ' + lp.name : miss12.length ? miss12.length + ' of the 12 months up to ' + lp.name + ' are missing' : '12 months up to ' + lp.name + ' synced', act: syncBtn('ltm', miss12, 'Sync ' + miss12.length + ' month(s)') });
                var prevY = cal.filter(function (p) { return p.year === lp.year - 1; }), missPy = prevY.filter(function (p) { return !cells[p.seq]; }).map(function (p) { return p.seq; });
                items.push({ k: 'py', adm: true, label: 'Last year (' + (lp.year - 1) + ') — growth and every "vs last year" figure', ok: prevY.length > 0 && !missPy.length, part: missPy.length > 0 && missPy.length < prevY.length,
                    info: !prevY.length ? 'the calendar has no ' + (lp.year - 1) : missPy.length ? missPy.length + ' of ' + prevY.length + ' periods of ' + (lp.year - 1) + ' not synced' : 'all ' + prevY.length + ' periods synced', act: syncBtn('py', missPy, 'Sync ' + (lp.year - 1)) });
            }
            items.push({ k: 'bud', label: 'Budget — budget KPIs and monitors', ok: nBud > 0, info: nBud ? nBud.toLocaleString() + ' budget balance rows' : 'not loaded — the trial balance sync reads actuals; the full GL load also reads the budget (GL_BUDGET_BALANCES)', act: '<button class="btn sm" data-md="status">Full GL load</button>' });
            var missing = items.filter(function (it) { return it.col && !it.ok; }), admin = FL.who && FL.who.admin;
            var html = '<div class="row"><h3 style="margin:0"><i class="fa-solid fa-list-check"></i> Master data checklist</h3><span class="sm ' + (items.every(function (x) { return x.ok; }) ? 'pos' : 'warn') + '">' +
                items.filter(function (x) { return x.ok; }).length + ' of ' + items.length + ' ready</span><span class="grow"></span>' +
                (missing.length ? '<button class="btn sm primary" data-md="all"' + (admin ? '' : ' disabled') + '><i class="fa-solid fa-cloud-arrow-down"></i> Sync all missing (' + missing.length + ')</button>' : '') + '</div>' +
                '<table class="t md-list"><tbody>' + items.map(function (it) {
                    return '<tr class="' + (it.ok ? 'ok' : it.part ? 'part' : 'miss') + '"><td class="md-st">' + (it.ok ? '✓' : it.part ? '◐' : '✗') + '</td><td><b>' + esc(it.label) + '</b><div class="sm muted md-info" data-k="' + it.k + '">' + esc(it.info) + '</div></td><td class="md-act">' + (admin || !(it.col || it.adm) ? it.act : '') + '</td></tr>';
                }).join('') + '</tbody></table><p class="sm muted" style="margin:6px 0 0">Names and account types of the trial balance come from these values; after a sync the statements are rebuilt with them.</p>';
            boxes.forEach(function (b) {
                b.innerHTML = html;
                b.querySelectorAll('[data-md]').forEach(function (btn) {
                    btn.onclick = function () {
                        var a = btn.dataset.md;
                        if (a === 'setup') return FL.dataTab.dataSetup();
                        if (a === 'mapping') return FL.dataTab.go('mapping');
                        if (a === 'status') return FL.dataTab.go('status');
                        if (a === 'seqs') return T.sync(btn.dataset.seqs.split(',').map(Number), false);
                        if (a === 'extpick') { if (!$('ts-ext')) FL.dataTab.go('tbsync'); setTimeout(function () { if ($('ts-set')) { $('ts-set').open = true; $('ts-ext').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('ts-ext').classList.add('flash'); } }, 300); return; }
                        if (a === 'extsync') return T.extSync(btn.dataset.seqs.split(',').map(Number), false);
                        var cols = a === 'all' ? missing.map(function (x) { return x.col; }) : [btn.dataset.col];
                        T.mdSync(a === 'apex' ? 'apex' : 'fusion', cols, btn);
                    };
                });
            });
        });
    };
    /** After a sync: segment values this PC does not have yet (names, account types) come along — from APEX when it has them, else from Fusion */
    T.autoMd = function () {
        var l = T.ledgerObj(); if (!l || !(FL.who && FL.who.admin)) return;
        var led = FL.fusion.ledgerFor(l, FL.fusion.rolesOf(L.disc)), cols = [led.account, led.company, led.costCentre].concat(T.extCols()).filter(function (c, i, a) { return c && a.indexOf(c) === i; });
        return Promise.all(cols.map(function (c) { return FL.call('finSegValues', { coaId: l.coaId, column: c }).then(function (r) { return (r.values || []).length ? null : c; }).catch(function () { return c; }); }))
            .then(function (miss) {
                miss = miss.filter(Boolean); if (!miss.length) return;
                FL.toast('Reading the names of ' + miss.join(', ') + ' (master data) …', 'info');
                return Promise.all(miss.map(function (c) { return FL.apexStore.loadSegValues(L.pod || '', l.coaId, c).then(function (v) { return v.length ? null : c; }).catch(function () { return c; }); })).then(function (still) {
                    var fromApex = miss.filter(function (c) { return still.indexOf(c) < 0; }), fromFusion = still.filter(Boolean);
                    return (fromApex.length ? T.mdSync('apex', fromApex, null, true) : Promise.resolve()).then(function () { if (fromFusion.length) return T.mdSync('fusion', fromFusion, null, true); });
                });
            });
    };
    /** Values of the given segment columns from APEX or Fusion → this PC (and APEX), then the statements are rebuilt */
    T.mdSync = function (where, cols, btn, quiet) {
        var l = T.ledgerObj(); if (!l) return;
        var pod = L.pod || '', coa = l.coaId, n = 0, t0 = Date.now();
        T.pfx().forEach(function (x) { if ($(x + '-md')) $(x + '-md').querySelectorAll('button').forEach(function (b) { b.disabled = true; }); });
        if (btn) btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> ' + (where === 'apex' ? 'APEX…' : 'syncing…');
        var p = where === 'fusion' ? FL.fusion.progress('Master data · ' + cols.join(', ') + ' values…', true) : null;
        var tick = setInterval(function () { if (btn && btn.isConnected) btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> ' + FL.fusion.secs(Date.now() - t0); }, 1000);
        var chain = Promise.resolve();
        cols.forEach(function (col) {
            chain = chain.then(function () {
                if (where === 'apex') return FL.apexStore.loadSegValues(pod, coa, col).then(function (v) {
                    if (!v.length) return;
                    n += v.length;
                    return FL.call('finSegValuesSave', { coaId: coa, column: col, values: v.map(function (x) { return { value: x.value, description: x.description, accountType: x.accountType, combinations: x.combinations }; }) }, 120000);
                });
                return FL.call('finFusionSegValues', { pod: pod, coaId: coa, column: col }, 30 * 60000, p).then(function (r) {
                    if (r && r.ok === false) throw new Error(r.error || 'failed');
                    var vals = (r.values || []).map(function (x) { return { value: x.value, description: x.description, accountType: x.accountType, combinations: x.combinations }; });
                    n += vals.length;
                    return FL.apexStore.saveSegValues(pod, coa, col, vals).catch(function () { /* the APEX copy is optional */ });
                });
            });
        });
        return chain.then(function () {
            clearInterval(tick); if (p) FL.fusion.finish();
            if (!n) { if (!quiet) FL.toast(where === 'apex' ? 'APEX has no values for ' + cols.join(', ') + ' yet — use Sync (from Fusion)' : 'No values came back', 'err'); return; }
            FL.toast(n.toLocaleString() + ' values of ' + cols.join(', ') + ' on this PC — statements rebuilt', 'ok');
            return FL.refresh();
        }).catch(function (e) { clearInterval(tick); if (p) FL.fusion.finish(String(e && e.message || e)); if (!quiet) FL.toast(String(e && e.message || e), 'err'); })
            .then(function () { T.md(); });
    };

    // ── the default query (the host builds the same from this pod's columns) ──
    T.defaultQ = function () {
        var o = L.opt, sums = ['begin_balance_dr', 'begin_balance_cr', 'period_net_dr', 'period_net_cr'].map(function (c) { return 'SUM(b.' + c + ') ' + c; }).join(', ');
        var segs = 'c.{COMPANY_SEGMENT}, c.{ACCOUNT_SEGMENT}' + (L.byCc ? ', c.{COST_CENTRE_SEGMENT}' : '');
        return 'SELECT ' + (o.hint ? '/*+ LEADING(b) USE_HASH(c) PARALLEL(4) */ ' : '') + 'b.ledger_id, b.period_name, b.currency_code, b.translated_flag,\n' +
            '       c.{COMPANY_SEGMENT} company, c.{ACCOUNT_SEGMENT} account' + (L.byCc ? ', c.{COST_CENTRE_SEGMENT} cost_centre' : '') + ', MAX(c.account_type) account_type,\n       ' + sums +
            "\nFROM gl_balances b JOIN gl_code_combinations c ON c.code_combination_id = b.code_combination_id\nWHERE b.ledger_id = {LEDGER_ID} AND b.period_name = '{PERIOD}' AND b.currency_code = '{CURRENCY}' AND b.actual_flag = 'A'" +
            (o.skipZero ? "\n  AND b.template_id IS NULL\n  AND (NVL(b.begin_balance_dr, 0) <> NVL(b.begin_balance_cr, 0) OR NVL(b.period_net_dr, 0) <> 0 OR NVL(b.period_net_cr, 0) <> 0)" : "\n  AND c.summary_flag = 'N'") +
            '{COMPANY_FILTER}\nGROUP BY b.ledger_id, b.period_name, b.currency_code, b.translated_flag, ' + segs;
    };
    // fixed ledger / period / currency values, own ROWNUM, no {PERIOD}
    T.qIssues = function (q) {
        var fixes = [], re = [[/(\b(?:\w+\.)?ledger_id\s*=\s*)(\d+)/gi, '{LEDGER_ID}', false], [/(\b(?:\w+\.)?period_name\s*=\s*)('[^'{}]*')/gi, '{PERIOD}', true], [/(\b(?:\w+\.)?currency_code\s*=\s*)('[^'{}]*')/gi, '{CURRENCY}', true]];
        re.forEach(function (r) { var m; r[0].lastIndex = 0; while ((m = r[0].exec(q))) fixes.push({ from: m[2], to: r[2] ? "'" + r[1] + "'" : r[1] }); });
        var coCol = T.companyCol(), fixedCo = coCol ? new RegExp('\\s+AND\\s+(?:\\w+\\.)?' + coCol + "\\s*(=\\s*'[^']*'|IN\\s*\\([^)]*\\))", 'i').exec(q) : null;
        return { fixes: fixes, paging: /\bROWNUM\b|\bROW_NUMBER\s*\(/i.test(q), noPeriod: !/\{PERIOD\}/.test(T.toTemplate(q)),
            fixedCo: fixedCo ? fixedCo[0].trim() : null, noCoFilter: L.opt.perCompany && !/\{COMPANY_FILTER\}/.test(q) };
    };
    /** The bar under the query; `run` = Sync was pressed (Use placeholders & sync / Sync as is). True when something needs a look. */
    T.qCheck = function (run) {
        var box = $('tl-qfix'); if (!box) return false;
        var q = $('tl-qtext').value, is = T.qIssues(q), parts = [];
        if (is.fixes.length) parts.push('<div><b><i class="fa-solid fa-wand-magic-sparkles"></i> Fixed values</b> — each period read needs its own: ' +
            is.fixes.map(function (f) { return '<span class="tl-fx"><s>' + esc(f.from) + '</s> → <code>' + esc(f.to) + '</code></span>'; }).join(' ') + '</div>');
        if (is.fixedCo || is.noCoFilter) parts.push('<div><b><i class="fa-solid fa-building"></i> ' + (is.fixedCo ? 'Company written into the query' : 'No {COMPANY_FILTER}') + '</b> — ' +
            (is.fixedCo ? '<code>' + esc(is.fixedCo) + '</code> reads one company whatever you tick; ' : '') + 'with one query per company the app puts <code>{COMPANY_FILTER}</code> (<code>AND c.' + esc(T.companyCol() || 'SEGMENTn') + " = '…'</code>) there for each company.</div>");
        if (is.paging) parts.push('<div><b><i class="fa-solid fa-layer-group"></i> Own ROWNUM / ROW_NUMBER</b> — not needed: the grouped result is read in one go; yours would cut each period short.</div>');
        else if (is.noPeriod) parts.push('<div><b><i class="fa-solid fa-triangle-exclamation"></i> No {PERIOD}</b> — every period would return the same rows.</div>');
        if (!parts.length) { box.innerHTML = ''; return false; }
        box.innerHTML = '<div class="tl-qwarn">' + parts.join('') + '<div class="row" style="margin-top:6px">' +
            (is.fixes.length || is.fixedCo || is.noCoFilter ? '<button class="btn sm primary" id="tl-qfx">' + (run ? 'Fix &amp; sync' : 'Fix the query') + '</button>' : '') +
            (run ? '<button class="btn sm" id="tl-qasis">Sync as is</button>' : '') + '</div></div>';
        if ($('tl-qfx')) $('tl-qfx').onclick = function () { $('tl-qtext').value = T.toTemplate($('tl-qtext').value); var again = T.qCheck(run); if (run && !again) T.sync(T._pending, T._pendingRefresh); };
        if ($('tl-qasis')) $('tl-qasis').onclick = function () { T._asIs = true; box.innerHTML = ''; T.sync(T._pending, T._pendingRefresh); };
        return true;
    };
    T.companyCol = function () { var l = T.ledgerObj(); return l ? FL.fusion.ledgerFor(l, FL.fusion.rolesOf(L.disc)).company : null; };
    T.toTemplate = function (q) {
        var coCol = T.companyCol();
        if (coCol) {   // a company written into the query → {COMPANY_FILTER}; none at all (one query per company) → before GROUP BY
            var re = new RegExp('\\s+AND\\s+(?:\\w+\\.)?' + coCol + "\\s*(=\\s*'[^']*'|IN\\s*\\([^)]*\\))", 'i');
            if (re.test(q)) q = q.replace(re, '{COMPANY_FILTER}');
            else if (L.opt.perCompany && !/\{COMPANY_FILTER\}/.test(q)) { var g = /\s+GROUP\s+BY\b/i.exec(q); q = g ? q.slice(0, g.index) + '{COMPANY_FILTER}' + q.slice(g.index) : q + '{COMPANY_FILTER}'; }
        }
        return q.replace(/(\b(?:\w+\.)?ledger_id\s*=\s*)\d+/gi, '$1{LEDGER_ID}')
            .replace(/(\b(?:\w+\.)?period_name\s*=\s*)'[^'{}]*'/gi, "$1'{PERIOD}'")
            .replace(/(\b(?:\w+\.)?currency_code\s*=\s*)'[^'{}]*'/gi, "$1'{CURRENCY}'");
    };

    // ── ledger, periods, companies ──
    T.fillLedgers = function () {
        var pod = L.pod || '';
        var sels = T.pfx().map(function (x) { return $(x + '-led'); }).filter(Boolean);
        sels.forEach(function (sl) { sl.innerHTML = '<option>reading the chart of accounts…</option>'; });
        return FL.fusion.getDisc(pod).then(function (r) {
            sels = T.pfx().map(function (x) { return $(x + '-led'); }).filter(Boolean);
            if ((L.pod || '') !== pod || !sels.length) return;
            if (!r) {
                L.disc = null; sels.forEach(function (sl) { sl.innerHTML = '<option value="">— discover first —</option>'; });
                T.pfx().forEach(function (x) { if ($(x + '-board')) $(x + '-board').innerHTML = '<span class="sm">Nothing discovered for ' + esc(pod || 'the logged-in pod') + ' — <a onclick="FL.dataTab.dataSetup()">Discover the ledgers</a> once (Data › Fusion setup).</span>'; });
                return;
            }
            L.disc = r.disc;
            var leds = (r.disc.ledgers || []).filter(function (l) { return l.coaId; }), def = FL.fusion.defaultIds(r.disc);
            if (!leds.some(function (l) { return String(l.id) === String(L.ledger); })) L.ledger = def[0] || (leds[0] && String(leds[0].id));
            sels.forEach(function (sl) {
                sl.innerHTML = leds.map(function (l) { return '<option value="' + esc(l.id) + '"' + (String(l.id) === String(L.ledger) ? ' selected' : '') + '>' + esc(l.name + ' · ' + l.currency + (l.category && l.category !== 'PRIMARY' ? ' · ' + l.category.toLowerCase() : '')) + '</option>'; }).join('');
                sl.onchange = function () { L.ledger = this.value; FL.lsSet('tbl.ledger', L.ledger); L.cos = []; L.sel = {}; T.fillPeriods(); };
            });
            T.fillPeriods();
        });
    };
    T.ledgerObj = function () { return L.disc ? (L.disc.ledgers || []).filter(function (l) { return String(l.id) === String(L.ledger); })[0] : null; };
    T.cal = function () { var l = T.ledgerObj(); return l ? FL.fusion.calOf(L.disc, l) : []; };
    /** the views on screen: ts = Data › Trial balance sync, tsm = the compact status in Data › SQL explorer */
    T.pfx = function () { return ['ts', 'tsm'].filter(function (x) { return $(x + '-board') || $(x + '-led'); }); };
    /** Compact status (Data › SQL explorer): ledger, years, the period tiles, Sync / open the full page */
    T.mini = function (el) {
        var admin = FL.who && FL.who.admin, s = FL.fusion.saved() || {};
        if (L.pod == null) L.pod = (s.setup && s.setup.pod) || s.pod || '';
        el.innerHTML = '<div class="card ts-main"><div class="row"><h3 style="margin:0"><i class="fa-solid fa-scale-balanced"></i> Trial balance sync status</h3><span class="sm muted">' + esc(L.pod || 'logged-in pod') + ' · tick periods to sync</span><span class="grow"></span>' +
            '<label class="sm">Ledger <select id="tsm-led"><option>…</option></select></label><div class="seg" id="tsm-years"></div></div>' +
            '<div id="tsm-board" class="ts-board"><div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i></div></div>' +
            '<div class="row ts-acts"><span class="sm muted">Companies, options and the query: Data › Trial balance sync</span><span class="grow"></span>' +
            '<button class="btn sm" id="tsm-full"><i class="fa-solid fa-up-right-from-square"></i> Full page</button>' + T.actBtns('tsm') + '</div><div id="tsm-live"></div></div><div class="card" style="margin-top:12px" id="tsm-md"></div>';
        T.wireActs('tsm');
        $('tsm-full').onclick = function () { FL.dataTab.go('tbsync'); };
        T.paintLive();
        T.fillLedgers();
    };
    /** Delete / Overwrite / Sync for the ticked tiles — the same in both views */
    T.actBtns = function (x) {
        return '<button class="btn sm" id="' + x + '-del" disabled title="Delete the ticked periods from this PC (the statements are rebuilt without them)"><i class="fa-solid fa-trash"></i> Delete</button>' +
            '<button class="btn sm" id="' + x + '-over" disabled title="Read the ticked periods again from Fusion and replace what this PC holds (after postings in Fusion)"><i class="fa-solid fa-rotate"></i> Overwrite</button>' +
            '<button class="btn sm" id="' + x + '-xg" disabled title="Extended segments for the ticked periods"><i class="fa-solid fa-layer-group"></i> Sync extended</button>' +
            '<button class="btn primary" id="' + x + '-go" disabled title="Read what is missing for the ticked periods (companies already on this PC are kept)"><i class="fa-solid fa-cloud-arrow-down"></i> Sync</button>';
    };
    T.wireActs = function (x) {
        $(x + '-go').onclick = function () { T.sync(T.selSeqs(), false); };
        $(x + '-over').onclick = function () {
            var cells = T.cells(), names = T.cal().filter(function (p) { return L.sel[p.seq] && cells[p.seq]; }).map(function (p) { return p.name; });
            if (names.length && !confirm('Read ' + names.join(', ') + ' again from Fusion and replace what this PC holds for them?')) return;
            T.sync(T.selSeqs(), true);
        };
        $(x + '-del').onclick = function () { T.remove(); };
        $(x + '-xg').onclick = function () { T.extSync(T.selSeqs(), false); };
    };
    T.latest = function () { var cal = T.cal(), today = new Date().toISOString().slice(0, 10), st = cal.filter(function (p) { return !p.start || p.start <= today; }); return st.length ? st[st.length - 1] : cal[cal.length - 1]; };
    T.fillPeriods = function () {
        var l = T.ledgerObj(); if (!l) return;
        var cal = T.cal(), years = [];
        cal.forEach(function (p) { var y = Math.floor(p.seq / 100); if (years.indexOf(y) < 0) years.push(y); });
        if (years.indexOf(L.year) < 0) { var lt = T.latest(); L.year = lt ? Math.floor(lt.seq / 100) : years[years.length - 1]; }
        L.years = years;
        // companies (Settings, full page only)
        var cos = l.companies || [];
        if ($('ts-cos')) $('ts-cos').innerHTML = cos.length ? '<label class="chip"><input type="checkbox" id="ts-all"' + (L.cos.length ? '' : ' checked') + '> all ' + cos.length + '</label>' + cos.map(function (c) {
            return '<label class="chip"><input type="checkbox" class="ts-co" value="' + esc(c.value) + '"' + (L.cos.indexOf(c.value) >= 0 ? ' checked' : '') + '> ' + esc(c.value) + (c.legalEntity ? ' <span class="muted">' + esc(c.legalEntity) + '</span>' : '') + '</label>';
        }).join('') : '<span class="sm muted">every company of the ledger</span>';
        var pick = function () { L.cos = Array.prototype.map.call(document.querySelectorAll('.ts-co:checked'), function (c) { return c.value; }); if ($('ts-all')) $('ts-all').checked = !L.cos.length; T.setSum(); T.paintBoard(); };
        document.querySelectorAll('.ts-co').forEach(function (c) { c.onchange = pick; });
        if ($('ts-all')) $('ts-all').onchange = function () { if (this.checked) { document.querySelectorAll('.ts-co').forEach(function (c) { c.checked = false; }); L.cos = []; } else this.checked = !L.cos.length; T.setSum(); T.paintBoard(); };
        T.setSum();
        T.board().then(function () { T.md(); });
    };
    T.setSum = function () {
        var l = T.ledgerObj(), n = (l && l.companies || []).length;
        if ($('ts-setsum')) $('ts-setsum').textContent = (L.cos.length ? L.cos.length + ' of ' + n + ' companies' : 'every company' + (n ? ' (' + n + ')' : '')) + (L.byCc ? ' · by cost centre' : '') +
            (L.fold ? ' · adjustment periods folded' : '') + ' · ' + L.par + ' in parallel' + (L.opt.perCompany ? ' · one query per company' : '') + (L.query ? ' · your own query' : '');
    };
    /** The companies a period must hold to count as synced */
    T.want = function () { var l = T.ledgerObj(); return L.cos.length ? L.cos : (l && l.companies || []).map(function (c) { return c.value; }); };

    // ── the year board: one tile per period — ✓ synced, n/m some companies, ✗ not synced, live while syncing ──
    T.board = function () {
        return Promise.all([FL.call('finTbSyncStatus'), FL.call('finTbExtStatus').catch(function () { return { rows: [] }; })]).then(function (rr) { L.status = rr[0]; L.ext = rr[1]; T.paintBoard(); T.paintExt(); }).catch(function (e) { if ($('ts-board')) $('ts-board').innerHTML = '<div class="callout bad">' + esc(e) + '</div>'; });
    };
    T.cells = function () {
        var cells = {}, l = T.ledgerObj(); if (!l || !L.status) return cells;
        (L.status.rows || []).forEach(function (x) {
            if ((x.pod || '') !== (L.pod || '') || String(x.ledgerId) !== String(l.id) || x.seq == null) return;
            var c = cells[x.seq] = cells[x.seq] || { names: {}, cos: {}, all: false, rows: 0, at: '', grains: {}, adj: [] };
            c.names[x.period] = 1; c.rows += +x.rows || 0; c.grains[x.grain] = 1; if (x.adj) c.adj.push(x.period);
            if (x.companies === '*') c.all = true; else String(x.companies || '').split(',').forEach(function (v) { if (v) c.cos[v] = 1; });
            if (String(x.at) > c.at) c.at = String(x.at);
        });
        return cells;
    };
    /** state of one period: done / part / none, plus live (queued / running / failed) while a sync runs */
    T.stateOf = function (p, cells, want) {
        var c = cells[p.seq], lv = T.live && T.live.per[p.name];
        if (lv && (lv.state === 'running' || lv.state === 'queued' || lv.state === 'failed')) return lv.state;
        if (!c) return 'none';
        var have = want.filter(function (v) { return c.all || c.cos[v]; }).length;
        return c.all || !want.length || have >= want.length ? 'done' : 'part';
    };
    T.paintBoard = function () {
        var l = T.ledgerObj(), views = T.pfx().filter(function (x) { return $(x + '-board'); }); if (!views.length || !l) return;
        var cal = T.cal(), cells = T.cells(), want = T.want(), y = L.year;
        // year chips with how much of each year is synced
        var yearsHtml = (L.years || []).map(function (yy) {
                var ps = cal.filter(function (p) { return Math.floor(p.seq / 100) === yy; }), n = ps.filter(function (p) { return T.stateOf(p, cells, want) === 'done'; }).length;
                return '<button data-y="' + yy + '" class="' + (yy === y ? 'on' : '') + '">' + yy + ' <span class="ts-yc ' + (n === ps.length ? 'pos' : n ? 'warn' : 'muted') + '">' + n + '/' + ps.length + '</span></button>';
            }).join('');
        var today = new Date().toISOString().slice(0, 10), ps = cal.filter(function (p) { return Math.floor(p.seq / 100) === y; });
        // plain symbols (no icon font needed): ✓ synced, ◐ some companies, ✗ not synced, ⏳ waiting, ⟳ syncing, ⚠ failed
        var ICON = { done: '✓', part: '◐', none: '✗', queued: '⏳', running: '<span class="ts-spin">⟳</span>', failed: '⚠' };
        var tiles = ps.map(function (p) {
            var st = T.stateOf(p, cells, want), c = cells[p.seq], lv = T.live && T.live.per[p.name], future = p.start && p.start > today;
            var have = c ? want.filter(function (v) { return c.all || c.cos[v]; }).length : 0;
            var line = st === 'running' ? 'syncing · company ' + Math.min(lv.done + 1, lv.total) + ' of ' + lv.total
                : st === 'queued' ? 'waiting' : st === 'failed' ? 'failed — ' + (lv.error || 'see Details')
                : st === 'done' ? (c.rows || 0).toLocaleString() + ' rows · ' + String(c.at).slice(5, 16)
                : st === 'part' ? have + ' of ' + want.length + ' companies' : future ? 'not open yet' : 'not synced';
            var tip = p.name + (c && c.adj.length ? ' (+ ' + c.adj.join(', ') + ')' : '') + (c ? '\n' + (c.all ? 'every company' : 'companies ' + Object.keys(c.cos).join(', ')) + '\n' + (c.rows || 0).toLocaleString() + ' rows · read ' + String(c.at).slice(0, 16) +
                (c.grains['CO,AC,CC'] ? ' · by cost centre' : '') : '\nnot on this PC yet') + (lv && lv.error ? '\n' + lv.error : '');
            return '<div class="ts-tile ' + st + (L.sel[p.seq] ? ' sel' : '') + (future ? ' future' : '') + '" data-s="' + p.seq + '" title="' + esc(tip) + '">' +
                '<div class="ts-tn"><input type="checkbox"' + (L.sel[p.seq] ? ' checked' : '') + ' tabindex="-1"> ' + esc(p.name) + '</div><div class="ts-ti">' + ICON[st] + '</div><div class="ts-tl">' + esc(line) + '</div>' +
                (c && c.grains['CO,AC,CC'] ? '<span class="ts-cc">cc</span>' : '') + T.extBadge(p, want) + '</div>';
        }).join('') || '<p class="sm muted">No periods in this year.</p>';
        var vt = '<div class="ts-vt"><div class="seg sm">' + [['table', 'fa-table-list', 'Table'], ['tiles', 'fa-table-cells', 'Tiles']].map(function (v) {
            return '<button data-vw="' + v[0] + '" class="' + (L.view === v[0] ? 'on' : '') + '"><i class="fa-solid ' + v[1] + '"></i> ' + v[2] + '</button>'; }).join('') + '</div></div>';
        if (L.view === 'table') tiles = T.table(ps, cells, want, today);
        views.forEach(function (x) {
            var box = $(x + '-board'); box.classList.toggle('ts-board-tbl', L.view === 'table'); box.innerHTML = vt + tiles;
            box.querySelectorAll('[data-vw]').forEach(function (b) { b.onclick = function () { L.view = b.dataset.vw; FL.lsSet('tbl.view', L.view); T.paintBoard(); }; });
            box.querySelectorAll('[data-row]').forEach(function (b) {
                b.onclick = function (ev) {
                    ev.stopPropagation();
                    var q = +b.dataset.s, a = b.dataset.row;
                    if (a === 'tb') T.sync([q], false); else if (a === 'tbo') T.sync([q], true); else if (a === 'ext') T.extSync([q], false); else if (a === 'exto') T.extSync([q], true);
                };
            });
            box.querySelectorAll('.ts-tr').forEach(function (tr) {
                tr.onclick = function (ev) { if (ev.target.closest('button') || (T.live && T.live.running)) return; var q = +tr.dataset.s; if (L.sel[q]) delete L.sel[q]; else L.sel[q] = 1; T.paintBoard(); };
            });
            if ($(x + '-years')) { $(x + '-years').innerHTML = yearsHtml; $(x + '-years').querySelectorAll('button').forEach(function (b) { b.onclick = function () { L.year = +b.dataset.y; FL.lsSet('tbl.year', L.year); T.paintBoard(); }; }); }
            box.querySelectorAll('.ts-tile').forEach(function (t) {
                t.onclick = function () { if (T.live && T.live.running) return; var q = +t.dataset.s; if (L.sel[q]) delete L.sel[q]; else L.sel[q] = 1; T.paintBoard(); };
            });
        });
        T.selChanged();
    };
    /** Table view: one row per period — trial balance status + buttons, extended segments status + buttons, live while syncing */
    T.table = function (ps, cells, want, today) {
        var ext = T.extCols(), xc = T.extCells(), admin = FL.who && FL.who.admin, run = (T.live && T.live.running) || (T.xlive && T.xlive.running);
        var cos = want.length, l = T.ledgerObj(), led = l ? FL.fusion.ledgerFor(l, FL.fusion.rolesOf(L.disc)) : {};
        var need = [led.company, led.account].concat(ext).filter(Boolean);
        var pill = function (cls, ico, txt, tip) { return '<span class="ts-st ' + cls + '" title="' + esc(tip || '') + '">' + ico + ' ' + esc(txt) + '</span>'; };
        var rows = ps.map(function (p) {
            var c = cells[p.seq], future = p.start && p.start > today, st = T.stateOf(p, cells, want), lv = T.live && T.live.per[p.name];
            var have = c ? want.filter(function (v) { return c.all || c.cos[v]; }).length : 0;
            var tb = st === 'running' ? pill('run', '<i class="fa-solid fa-circle-notch fa-spin"></i>', 'syncing · company ' + Math.min(lv.done + 1, lv.total) + ' of ' + lv.total)
                : st === 'queued' ? pill('run', '⏳', 'waiting') : st === 'failed' ? pill('bad', '⚠', 'failed', lv && lv.error)
                : st === 'done' ? pill('ok', '✓', 'Yes · ' + (c.rows || 0).toLocaleString() + ' rows · ' + String(c.at).slice(5, 16), (c.all ? 'every company' : 'companies ' + Object.keys(c.cos).join(', ')) + (c.adj.length ? ' · + ' + c.adj.join(', ') : ''))
                : st === 'part' ? pill('part', '◐', have + ' of ' + cos + ' companies') : future ? pill('off', '–', 'not open yet') : pill('no', '✗', 'No');
            var tbBtn = future || !admin ? '' : st === 'done' ? '<button class="btn sm" data-row="tbo" data-s="' + p.seq + '"' + (run ? ' disabled' : '') + ' title="Read again from Fusion and replace"><i class="fa-solid fa-rotate"></i> Overwrite</button>'
                : '<button class="btn sm primary" data-row="tb" data-s="' + p.seq + '"' + (run ? ' disabled' : '') + '><i class="fa-solid fa-cloud-arrow-down"></i> Sync</button>';
            var xs = T.extState(p.seq, want), xl = T.xlive && T.xlive.per[p.name], x = xc[p.seq];
            var miss = x ? need.filter(function (n) { return Object.keys(x.cos).every(function (co) { return x.cos[co].indexOf(n) < 0; }); }) : [];
            var ex = !ext.length ? pill('off', '–', 'no segments chosen')
                : xl && xl.state === 'running' ? pill('run', '<i class="fa-solid fa-circle-notch fa-spin"></i>', xl.acct ? 'company ' + xl.acct.co + ' · account ' + xl.acct.i + ' of ' + xl.acct.n
                    : 'syncing · ' + xl.done + ' of ' + xl.total + ' compan' + (xl.total === 1 ? 'y' : 'ies'), xl.acct ? 'Timed out per company - reading it account by account (now ' + xl.acct.name + ')' : '') + (xl.fails ? ' ' + pill('bad', '⚠', xl.fails.length + ' failed', xl.error) : '')
                : xl && xl.state === 'queued' ? pill('run', '⏳', 'waiting') : xl && xl.state === 'failed' ? pill('bad', '⚠', 'failed', xl.error)
                : xs === 'done' ? pill('ok', '✓', 'Yes · ' + (x.rows || 0).toLocaleString() + ' rows · ' + String(x.at).slice(5, 16), Object.keys(x.cos).length + ' compan(ies) · ' + need.join(', '))
                : xs === 'part' ? pill('part', '◐', miss.length ? 'missing ' + miss.join(', ') : 'some companies', 'Sync to complete it')
                : future ? pill('off', '–', 'not open yet') : pill('no', '✗', 'No');
            var exBtn = !ext.length || future || !admin ? '' : xs === 'done' ? '<button class="btn sm" data-row="exto" data-s="' + p.seq + '"' + (run ? ' disabled' : '') + '><i class="fa-solid fa-rotate"></i> Overwrite</button>'
                : '<button class="btn sm' + (st === 'done' ? ' primary' : '') + '" data-row="ext" data-s="' + p.seq + '"' + (run ? ' disabled' : '') + ' title="' + esc(st === 'done' ? 'Read the extended segments for this period' : 'Works on its own, but sync the trial balance too') + '"><i class="fa-solid fa-cloud-arrow-down"></i> Sync</button>';
            return '<tr class="ts-tr' + (L.sel[p.seq] ? ' sel' : '') + (future ? ' future' : '') + '" data-s="' + p.seq + '"><td><input type="checkbox"' + (L.sel[p.seq] ? ' checked' : '') + ' tabindex="-1"></td><td><b>' + esc(p.name) + '</b>' +
                (c && c.adj.length ? ' <span class="muted sm">+ ' + esc(c.adj.join(', ')) + '</span>' : '') + (future ? ' <span class="muted sm">not open yet</span>' : '') + '</td><td>' + tb + '</td><td>' + tbBtn + '</td><td class="ts-xc">' + ex + '</td><td>' + exBtn + '</td></tr>';
        }).join('');
        return '<table class="t ts-table"><thead><tr><th style="width:28px"></th><th>Period</th><th>Trial balance</th><th></th><th class="ts-xc">Extended segments' + (ext.length ? ' <span class="muted">(' + esc(ext.map(T.segName).map(function (n) { return n.replace(/ \(SEGMENT\d+\)$/, ''); }).join(', ')) + ')</span>' : '') + '</th><th></th></tr></thead><tbody>' +
            (rows || '<tr><td colspan="6" class="muted">No periods in this year.</td></tr>') + '</tbody></table>';
    };
    /** Live per-period state of an extended-segments sync from its progress events */
    T.extTrack = function (msg) {
        var xl = T.xlive; if (!xl) return;
        var periodOf = function (what) { var m = null; Object.keys(xl.per).forEach(function (n) { if (String(what || '').indexOf(' · ' + n + ' · extended') >= 0) m = n; }); return m; };
        if (msg.charAt(0) === '\u0001') {
            var e; try { e = JSON.parse(msg.slice(1)); } catch (x) { return; }
            if (e.t === 'sql') {
                var n = periodOf(e.what); xl.ids[e.id] = n;
                if (n) {
                    var pr = xl.per[n]; if (pr.state === 'queued') pr.state = 'running';
                    var am = /· company (.+?) · account (.+?) · (\d+) of (\d+)$/.exec(e.what || '');
                    pr.acct = am ? { co: am[1], i: +am[3], n: +am[4], name: am[2] } : pr.acct;
                }
            } else if (e.t === 'end') { var nn = xl.ids[e.id]; delete xl.ids[e.id]; if (nn && !e.ok) xl.per[nn].retry = e.error; }
            else if (e.t === 'ext' && xl.per[e.period]) {
                var pe = xl.per[e.period];
                if (e.state === 'split') { pe.split = (pe.split || 0) + 1; pe.retry = e.why; }
                else if (e.state === 'done') { pe.done = Math.min(pe.total, pe.done + 1); pe.acct = null; }
                else if (e.state === 'failed') { pe.fails = (pe.fails || []).concat(['company ' + e.company + ': ' + e.error]); pe.error = pe.fails.join(' · '); pe.acct = null; }
            }
        }
        clearTimeout(T._xt); T._xt = setTimeout(function () { T.paintBoard(); }, 150);
    };
    T.selSeqs = function () { return Object.keys(L.sel).map(Number).sort(); };
    T.select = function (how) {
        var cal = T.cal().filter(function (p) { return Math.floor(p.seq / 100) === L.year; }), cells = T.cells(), want = T.want(), today = new Date().toISOString().slice(0, 10);
        if (how === 'none') L.sel = {};
        else cal.forEach(function (p) {
            var st = T.stateOf(p, cells, want);
            if (how === 'all' || ((st === 'none' || st === 'part' || st === 'failed') && !(p.start && p.start > today))) L.sel[p.seq] = 1;
        });
        T.paintBoard();
    };
    T.selChanged = function () {
        var n = T.selSeqs().length, admin = FL.who && FL.who.admin, run = T.live && T.live.running, cells = T.cells();
        var held = T.selSeqs().filter(function (q) { return cells[q]; }).length;
        T.pfx().forEach(function (x) {
            var b = $(x + '-go'); if (b) { b.disabled = !n || !admin || run; b.innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i> ' + (n ? 'Sync ' + n + ' period' + (n === 1 ? '' : 's') : 'Sync — tick periods'); }
            if ($(x + '-over')) { $(x + '-over').disabled = !n || !admin || run; $(x + '-over').innerHTML = '<i class="fa-solid fa-rotate"></i> Overwrite' + (n ? ' ' + n : ''); }
            if ($(x + '-xg')) { var ne = T.extCols().length; $(x + '-xg').disabled = !n || !admin || run || !ne; $(x + '-xg').title = ne ? 'Extended segments for the ticked periods' : 'Choose the extended segments first (Settings)'; $(x + '-xg').innerHTML = '<i class="fa-solid fa-layer-group"></i> Sync extended' + (n && ne ? ' ' + n : ''); }
            if ($(x + '-del')) { $(x + '-del').disabled = !held || !admin || run; $(x + '-del').innerHTML = '<i class="fa-solid fa-trash"></i> Delete' + (held ? ' ' + held : ''); }
        });
    };
    T.remove = function () {
        var l = T.ledgerObj(), cells = T.cells(), names = [];
        T.selSeqs().forEach(function (s) { if (cells[s]) names = names.concat(Object.keys(cells[s].names)); });
        if (!names.length || !confirm('Delete ' + names.join(', ') + ' from this PC? The statements are rebuilt from the periods that stay; Sync reads them again any time.')) return;
        FL.call('finTbSyncDelete', { pod: L.pod || '', ledgerId: +l.id, periods: names }, 120000).then(function () { FL.toast('Removed', 'ok'); L.sel = {}; return FL.refresh(); })
            .catch(function (e) { FL.toast(String(e), 'err'); }).then(T.board);
    };

    // ── live status of a running sync (one line; Details has the full monitor) ──
    T.paintLive = function () {
        var boxes = T.pfx().map(function (x) { return $(x + '-live'); }).filter(Boolean), lv = T.live; if (!boxes.length) return;
        if (!lv) { boxes.forEach(function (b) { b.innerHTML = ''; }); return; }
        var names = Object.keys(lv.per), done = names.filter(function (n) { return lv.per[n].state === 'done'; }).length, failed = names.filter(function (n) { return lv.per[n].state === 'failed'; }).length;
        var cur = names.filter(function (n) { return lv.per[n].state === 'running'; });
        var qDone = names.reduce(function (a, n) { return a + lv.per[n].done; }, 0), qAll = names.reduce(function (a, n) { return a + lv.per[n].total; }, 0);
        var pct = qAll ? Math.round(qDone / qAll * 100) : 0, secs = FL.fusion.secs((lv.end || Date.now()) - lv.t0);
 var html = '<div class="ts-livebar ' + (lv.running ? 'run' : failed || lv.error ? 'bad' : 'ok') + '"><div class="row">' +
            (lv.running ? '<i class="fa-solid fa-circle-notch fa-spin"></i>' : failed || lv.error ? '<i class="fa-solid fa-circle-xmark"></i>' : '<i class="fa-solid fa-circle-check"></i>') +
            '<b>' + (lv.running ? 'Syncing ' + (cur.length ? cur.join(', ') : names.join(', ')) : lv.error ? 'Sync stopped' : 'Sync finished') + '</b>' +
            '<span class="sm">' + done + ' of ' + names.length + ' period(s) done' + (failed ? ' · ' + failed + ' failed' : '') + ' · ' + qDone + ' of ' + qAll + ' company reads · ' + secs + (lv.running && lv.q ? ' · ' + lv.q + ' quer' + (lv.q === 1 ? 'y' : 'ies') + ' in Fusion now' : '') + '</span>' +
            '<span class="grow"></span>' + (lv.running ? '<button class="btn sm ts-cancel"><i class="fa-solid fa-stop"></i> Cancel</button>' : '<button class="btn sm ghost ts-liveclose" title="Hide"><i class="fa-solid fa-xmark"></i></button>') + '</div>' +
            '<div class="fu-bar"><i style="width:' + (lv.running ? pct : 100) + '%"></i></div>' + (lv.error ? '<div class="sm neg">' + esc(lv.error) + '</div>' : '') + '</div>';
        boxes.forEach(function (b) {
            b.innerHTML = html;
            var c = b.querySelector('.ts-cancel'), x = b.querySelector('.ts-liveclose');
            if (c) c.onclick = function () { FL.call('finCancel', {}).catch(function () { /* already ended */ }); c.disabled = true; };
            if (x) x.onclick = function () { T.live = null; T.paintLive(); };
        });
    };
    /** Reads the host's progress (structured monitor events + log lines) into per-period states */
    T.track = function (msg) {
        var lv = T.live; if (!lv) return;
        var periodOf = function (what) { var m = null; Object.keys(lv.per).forEach(function (n) { if (String(what || '').indexOf(' · ' + n + ' ') >= 0 || String(what || '').indexOf(' · ' + n + ' ·') >= 0) m = n; }); return m; };
        if (msg.charAt(0) === '\u0001') {
            var e; try { e = JSON.parse(msg.slice(1)); } catch (x) { return; }
            if (e.t === 'sql') { var n = periodOf(e.what); lv.ids[e.id] = n; lv.q++; if (n && lv.per[n].state === 'queued') lv.per[n].state = 'running'; }
            else if (e.t === 'end') {
                var nn = lv.ids[e.id]; delete lv.ids[e.id]; lv.q = Math.max(0, lv.q - 1);
                if (nn) {
                    var pp = lv.per[nn];
                    if (e.ok && !e.skipped) pp.done = Math.min(pp.total, pp.done + 1);   // companies kept on this PC are counted by the period's ✓ line
                    else { pp.state = 'failed'; pp.error = e.error; }
                }
            }
        } else {
            var m = /^✓ (\S+): /.exec(msg.trim());
            if (m && lv.per[m[1]]) { lv.per[m[1]].state = 'done'; lv.per[m[1]].done = lv.per[m[1]].total; }
            var k = /^✓ (\S+) already on this PC/.exec(msg.trim());
            if (k && lv.per[k[1]]) { lv.per[k[1]].state = 'done'; lv.per[k[1]].done = lv.per[k[1]].total; }
        }
        clearTimeout(T._pt); T._pt = setTimeout(function () { T.paintLive(); T.paintBoard(); }, 150);
    };

    // ── extended segments: balances by company × account × extra segments (cost centre, analysis, salesperson …) in fin_gl_balances_ext ──
    L.extAuto = FL.ls('tbl.extAuto', true);
    L.view = FL.ls('tbl.view', 'table');
    T.coaOf = function () { var l = T.ledgerObj(); return l && L.disc && (L.disc.coas || {})[String(l.coaId)]; };
    T.segName = function (col) { var c = T.coaOf(), sg = c && (c.segments || []).filter(function (x) { return x.col === col; })[0]; return sg ? sg.name + ' (' + col + ')' : col; };
    /** The extra segments chosen for this ledger's chart of accounts (config.json tbsync.ext[coaId]) */
    T.extCols = function () { var l = T.ledgerObj(); if (!l) return []; var e = ((FL.config || {}).tbsync || {}).ext || {}; return (e[String(l.coaId)] || []).slice(); };
    /** period seq → {cos: {company: segments}, rows, at} of this pod × ledger */
    T.extCells = function () {
        var cells = {}, l = T.ledgerObj(); if (!l || !L.ext) return cells;
        var cal = T.cal(), seqOf = {}; cal.forEach(function (p) { seqOf[p.name] = p.seq; });
        (L.ext.rows || []).forEach(function (x) {
            if ((x.pod || '') !== (L.pod || '') || String(x.ledgerId) !== String(l.id)) return;
            var q = x.seq != null ? +x.seq : seqOf[x.period]; if (q == null) return;
            var c = cells[q] = cells[q] || { cos: {}, rows: 0, at: '' };
            var segs = String(x.segments || '').split(',');
            c.cos[x.company] = c.cos[x.company] ? c.cos[x.company].filter(function (g) { return segs.indexOf(g) >= 0; }) : segs;   // adjustment periods too: what every part has
            c.rows += +x.rows || 0; if (String(x.at) > c.at) c.at = String(x.at);
        });
        return cells;
    };
    T.extState = function (seq, want) {
        var ext = T.extCols(), c = T.extCells()[seq]; if (!ext.length || !c) return 'none';
        var l = T.ledgerObj(), led = l ? FL.fusion.ledgerFor(l, FL.fusion.rolesOf(L.disc)) : {}, need = [led.company, led.account].concat(ext);
        var cos = want.length ? want : Object.keys(c.cos);
        var ok = cos.filter(function (co) { var g = c.cos[co]; return g && need.every(function (n) { return !n || g.indexOf(n) >= 0; }); }).length;
        return ok >= cos.length ? 'done' : ok ? 'part' : 'none';
    };
    T.extBadge = function (p, want) {
        if (!T.extCols().length) return '';
        var st = T.extState(p.seq, want), c = T.extCells()[p.seq];
        return st === 'none' ? '' : '<span class="ts-ext-b ' + st + '" title="' + esc('Extended segments ' + (st === 'done' ? 'synced' : 'partly synced') + (c ? ' · ' + c.rows.toLocaleString() + ' rows · read ' + String(c.at).slice(0, 16) : '')) + '">ext' + (st === 'done' ? ' ✓' : ' ◐') + '</span>';
    };
    /** Settings › Extended segments: chips for every segment of the chart (company and account are always in) */
    T.paintExt = function () {
        var box = $('ts-ext'), c = T.coaOf(), l = T.ledgerObj(); if (!box) return;
        if (!c || !l) { box.innerHTML = ''; return; }
        var led = FL.fusion.ledgerFor(l, FL.fusion.rolesOf(L.disc)), ext = T.extCols(), admin = FL.who && FL.who.admin;
        var cells = T.extCells(), n = Object.keys(T.cells()).length, done = Object.keys(T.cells()).filter(function (q) { return T.extState(+q, T.want()) === 'done'; }).length;
        box.innerHTML = '<div class="row" style="margin-top:10px"><b class="sm"><i class="fa-solid fa-layer-group"></i> Extended segments</b><span class="sm muted">balances by company × account × these segments, kept in their own table (fin_gl_balances_ext, view fin_gl_ext_v) — the trial balance stays fast</span></div>' +
            '<div class="tl-cos" style="margin-top:4px">' + (c.segments || []).map(function (sg) {
                var fixed = sg.col === led.company || sg.col === led.account;
                return '<label class="chip' + (fixed ? ' fixed' : '') + '" title="' + esc(fixed ? 'always included' : (sg.qualifiers || []).join(' ')) + '"><input type="checkbox" class="ts-xs" value="' + esc(sg.col) + '"' + (fixed || ext.indexOf(sg.col) >= 0 ? ' checked' : '') + (fixed || !admin ? ' disabled' : '') + '> ' + esc(sg.name) + ' <span class="muted">' + esc(sg.col.replace('SEGMENT', 'S')) + '</span></label>';
            }).join('') + '</div>' +
            '<div class="row sm" style="margin-top:4px"><span>Read</span><select id="ts-xby" title="A company whose query times out is read again account by account">' +
            [['auto', 'per company — account by account when it times out'], ['account', 'always account by account'], ['company', 'per company only']].map(function (o) { return '<option value="' + o[0] + '"' + (L.extBy === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>' +
            '<span id="ts-xbw"' + (L.extBy === 'company' ? ' hidden' : '') + '>accounts per query <input type="number" id="ts-xbatch" min="1" max="50" value="' + L.extBatch + '" style="width:56px" title="A batch that fails is split in half, down to one account"></span></div>' +
            '<div class="row sm" style="margin-top:4px"><label><input type="checkbox" id="ts-xauto"' + (L.extAuto ? ' checked' : '') + '> sync them after every trial balance sync</label>' +
            '<span class="muted">' + (ext.length ? done + ' of ' + n + ' synced period(s) have them · ' + Object.keys(cells).length + ' period(s) on this PC' : 'nothing chosen') + '</span><span class="grow"></span>' +
            (ext.length && Object.keys(cells).length ? '<button class="btn sm" id="ts-xopen" title="P&L, pivot and trial balance by these segments"><i class="fa-solid fa-layer-group"></i> Open Segment P&amp;L</button>' : '') + (admin ? '<button class="btn sm" id="ts-xsave" disabled><i class="fa-solid fa-floppy-disk"></i> Save choice</button><button class="btn sm primary" id="ts-xgo"' + (ext.length ? '' : ' disabled') + ' title="For the ticked periods, or every synced period that lacks them"><i class="fa-solid fa-cloud-arrow-down"></i> Sync extended</button>' : '') + '</div>';
        var chosen = function () { return [].map.call(box.querySelectorAll('.ts-xs:checked:not([disabled])'), function (i) { return i.value; }); };
        box.querySelectorAll('.ts-xs').forEach(function (i) { i.onchange = function () { if ($('ts-xsave')) $('ts-xsave').disabled = chosen().join() === ext.join(); }; });
        if ($('ts-xopen')) $('ts-xopen').onclick = function () { FL.show('segpl'); };
        $('ts-xauto').onchange = function () { L.extAuto = this.checked; FL.lsSet('tbl.extAuto', L.extAuto); };
        $('ts-xby').onchange = function () { L.extBy = this.value; FL.lsSet('tbl.extBy', L.extBy); $('ts-xbw').hidden = L.extBy === 'company'; };
        $('ts-xbatch').onchange = function () { L.extBatch = Math.max(1, Math.min(50, parseInt(this.value, 10) || 1)); this.value = L.extBatch; FL.lsSet('tbl.extBatch', L.extBatch); };
        if ($('ts-xsave')) $('ts-xsave').onclick = function () {
            FL.config.tbsync = FL.config.tbsync || {}; FL.config.tbsync.ext = FL.config.tbsync.ext || {}; FL.config.tbsync.ext[String(l.coaId)] = chosen();
            FL.saveConfig().then(function () { FL.toast('Extended segments saved — ' + (chosen().length ? 'press Sync extended' : 'none'), 'ok'); T.paintExt(); T.paintBoard(); T.md(); });
        };
        if ($('ts-xgo')) $('ts-xgo').onclick = function () {
            var sel = T.selSeqs(), cellsTb = T.cells();
            var list = sel.length ? sel : Object.keys(cellsTb).map(Number).filter(function (q) { return T.extState(q, T.want()) !== 'done'; });
            if (!list.length) { FL.toast('Every synced period already has the extended segments — tick periods to read them again', 'info'); return; }
            T.extSync(list, false);
        };
    };
    /** Reads the extended-segment balances of some periods (only what this PC lacks unless refresh) */
    T.extSync = function (seqs, refresh, quiet) {
        var l = T.ledgerObj(), ext = T.extCols(); if (!l || !ext.length || !seqs.length) return Promise.resolve();
        var led = FL.fusion.ledgerFor(l, FL.fusion.rolesOf(L.disc)), today = new Date().toISOString().slice(0, 10);
        var future = T.cal().filter(function (p) { return seqs.indexOf(p.seq) >= 0 && p.start && p.start > today; });
        if (future.length) { seqs = seqs.filter(function (q) { return !future.some(function (p) { return p.seq === q; }); }); if (!quiet) FL.toast(future.length + ' period(s) not open yet left out', 'info'); }
        if (!seqs.length) return Promise.resolve();
        var names = T.cal().filter(function (p) { return seqs.indexOf(p.seq) >= 0; }).map(function (p) { return p.name; });
        T.xlive = { running: true, per: {}, ids: {} };
        var nco = Math.max(1, T.want().length);
        names.forEach(function (n) { T.xlive.per[n] = { state: 'queued', done: 0, total: nco }; });
        T.paintBoard();
        var p0 = FL.fusion.progress('Extended segments (' + ext.map(T.segName).map(function (n) { return n.replace(/ \(SEGMENT\d+\)$/, ''); }).join(', ') + ') · ' + names[0] + (names.length > 1 ? ' – ' + names[names.length - 1] : '') + '…', true);
        var p = function (m) { p0(m); T.extTrack(String(m || '')); };
        FL.fusion.run.pod = L.pod || '';
        T.pfx().forEach(function (x) { if ($(x + '-md')) $(x + '-md').querySelectorAll('button').forEach(function (b) { b.disabled = true; }); });
        if ($('ts-xgo')) { $('ts-xgo').disabled = true; $('ts-xgo').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Syncing…'; }
        return FL.call('finTbExtSync', { pod: L.pod || '', options: { ledger: led, periodSeqs: seqs, foldAdjustments: L.fold, companies: L.cos, parallel: L.par, refresh: !!refresh, extSegments: ext, extBy: L.extBy, extAccountBatch: L.extBatch,
            skipZero: !!L.opt.skipZero, hint: !!L.opt.hint, allCompanies: (l.companies || []).map(function (c) { return c.value; }) } }, 90 * 60000, p).then(function (r) {
            FL.fusion.finish();
            (r.failed || []).forEach(function (f) { var x = T.xlive.per[f.period]; if (x) { x.state = 'failed'; x.error = 'company ' + f.company + ': ' + f.error; } });
            Object.keys(T.xlive.per).forEach(function (n) { var x = T.xlive.per[n]; if (x.state !== 'failed') { x.state = 'done'; x.done = x.total; } });
            if ((r.failed || []).length) FL.toast((r.failed.length) + ' period × company read(s) failed — see the rows marked ⚠', 'err');
            FL.toast('Extended segments: ' + (r.rows || 0).toLocaleString() + ' rows from ' + r.reads + ' quer' + (r.reads === 1 ? 'y' : 'ies') + (r.skipped ? ' · ' + r.skipped + ' already on this PC' : '') + ' — query fin_gl_ext_v', 'ok');
        }).catch(function (e) {
            var m = String(e && e.message || e); FL.fusion.finish(m); if (!quiet) FL.toast(m, 'err');
            Object.keys(T.xlive.per).forEach(function (n) { var x = T.xlive.per[n]; if (x.state === 'running' || x.state === 'queued') { x.state = 'failed'; x.error = x.error || m; } });
        }).then(function () { T.xlive.running = false; Object.keys(T.xlive.per).forEach(function (n) { if (T.xlive.per[n].state === 'done') delete T.xlive.per[n]; }); return T.board(); }).then(function () { T.md(); });
    };

    // ── sync ──
    /** seqs: the periods to sync (default = From–To); refresh: read again even when this PC has them */
    T.sync = function (seqs, refresh) {
        var l = T.ledgerObj(); if (!l) { FL.toast('Pick a ledger', 'err'); return; }
        var led = FL.fusion.ledgerFor(l, FL.fusion.rolesOf(L.disc));
        if (!led.company || !led.account) { FL.toast('The company / account segment of chart ' + l.coaId + ' is not set — Data › Fusion setup', 'err'); return; }
        var list = seqs || T.selSeqs();
        var today0 = new Date().toISOString().slice(0, 10), fut = T.cal().filter(function (p) { return list.indexOf(p.seq) >= 0 && p.start && p.start > today0; });
        if (fut.length) { list = list.filter(function (q) { return !fut.some(function (p) { return p.seq === q; }); }); FL.toast(fut.length + ' period(s) not open yet left out', 'info'); }
        if (!list.length) { FL.toast('Tick the periods to sync (open periods only)', 'err'); return; }
        var q = $('tl-qtext') ? $('tl-qtext').value.trim() : '';
        if (q) {
            if (!/^\s*(select|with)\b/i.test(q)) { FL.toast('The query must start with SELECT or WITH', 'err'); return; }
            T._pending = seqs; T._pendingRefresh = refresh;
            if (!T._asIs && T.qCheck(true)) { $('tl-qbox').open = true; return; }
            T._asIs = false;
            L.query = (L.defaultQuery && q === L.defaultQuery.trim()) || q === T.defaultQ().trim() ? '' : q;
            FL.lsSet('tbl.query.account', L.query); if ($('tl-qstate')) $('tl-qstate').textContent = L.query ? 'your own query' : 'default';
        }
        var names = T.cal().filter(function (p) { return list.indexOf(p.seq) >= 0; }).map(function (p) { return p.name; });
        var base = FL.fusion.progress('Trial balance sync ' + l.name + ' · ' + names[0] + (names.length > 1 ? ' – ' + names[names.length - 1] : '') + '…', true);
        FL.fusion.run.pod = L.pod || '';
        // the board follows the sync: every chosen period queued → running (company k of n) → done / failed
        var total = L.opt.perCompany !== false ? Math.max(1, T.want().length) : 1;
        T.live = { running: true, t0: Date.now(), per: {}, ids: {}, q: 0 };
        names.forEach(function (n) { T.live.per[n] = { state: 'queued', done: 0, total: total }; });
        T.paintLive(); T.paintBoard();
        var p = function (msg) { base(msg); T.track(String(msg || '')); };
        if ($('ts-go')) $('ts-go').disabled = true;
        FL.call('finTbSync', { pod: L.pod || '', options: { ledger: led, periodSeqs: list, foldAdjustments: L.fold, companies: L.cos, byCostCentre: L.byCc, parallel: L.par, refresh: !!refresh, queryTemplate: L.query || '',
            skipZero: !!L.opt.skipZero, allSums: !!L.opt.allSums, hint: !!L.opt.hint, perCompany: L.opt.perCompany !== false, allCompanies: (l.companies || []).map(function (c) { return c.value; }) } }, 60 * 60000, p).then(function (r) {
            FL.fusion.finish();
            Object.keys(T.live.per).forEach(function (n) { var x = T.live.per[n]; if (x.state !== 'failed') { x.state = 'done'; x.done = x.total; } });
            T.live.running = false; T.live.end = Date.now();
            if (r.defaultTemplate) { L.defaultQuery = r.defaultTemplate; FL.lsSet('tbl.dq.' + T.qKey(), r.defaultTemplate); if ($('tl-qtext') && !L.query) $('tl-qtext').value = r.defaultTemplate; }
            var b = r.built || {};
            FL.toast(names.length + ' period(s) synced' + (b.built ? ' — the statements now use ' + b.periods + ' synced period(s)' : b.reason === 'full load' ? ' — kept beside the full load the statements use' : ''), 'ok');
            return FL.refresh().then(function () { return T.autoMd(); }).then(function () { if (L.extAuto && T.extCols().length) return T.extSync(list, !!refresh, true); });
        }).catch(function (e) {
            var msg = String(e && e.message || e); FL.fusion.finish(msg);
            if (T.live) { T.live.running = false; T.live.end = Date.now(); T.live.error = msg; Object.keys(T.live.per).forEach(function (n) { var x = T.live.per[n]; if (x.state === 'running' || x.state === 'queued') { x.state = 'failed'; x.error = x.error || msg; } }); }
        }).then(function () { L.sel = {}; T.paintLive(); T.board(); });
    };

})();
