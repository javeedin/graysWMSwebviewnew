/* Finance Lens — Data › Trial balance sync: one ledger, a range of periods, read from Fusion grouped by company × account
   (× cost centre) — GL_BALANCES joined to GL_CODE_COMBINATIONS, SUM of the balance columns, one query per company and period,
   zero / summary rows skipped — and kept on this PC (DuckDB fin_gl_balances_acct). Every sync rebuilds the statements data from
   all synced periods (fin_balances …, source FUSION_TB) unless a full SQL / BICC load is on this PC, so Statements, Analytics and
   KPIs work on exactly the synced periods. The grid shows what is synced per ledger × period (all companies or n of m) and
   re-syncs or removes a selection. Host: finTbSync, finTbSyncStatus, finTbSyncDelete (classes/FinanceFusion.cs SyncTbAsync,
   FinanceLens.BuildFromTb). */
(function () {
    var T = FL.tbsync = {};
    var L = T.st = { pod: FL.ls('tbl.pod', null), ledger: FL.ls('tbl.ledger', null), from: null, to: null, cos: [], byCc: FL.ls('tbl.byCc', false), fold: true, par: FL.ls('tbl.par', 2),
        opt: Object.assign({ skipZero: true, allSums: false, hint: true, perCompany: true }, FL.ls('tbl.opt', {})), query: '', defaultQuery: '', sel: {}, status: null };
    T.qKey = function () { return 'account' + (L.byCc ? '.cc' : '') + '.' + (L.opt.skipZero ? 'z' : '') + (L.opt.allSums ? 'a' : '') + (L.opt.hint ? 'h' : ''); };
    T.loadQ = function () { L.query = FL.ls('tbl.query.account', ''); L.defaultQuery = FL.ls('tbl.dq.' + T.qKey(), ''); };
    T.loadQ();

    T.render = function (el) {
        var s = FL.fusion.saved() || {}, admin = FL.who && FL.who.admin;
        if (L.pod == null) L.pod = (s.setup && s.setup.pod) || s.pod || '';
        el.innerHTML = '<div class="card"><div class="row"><h3 style="margin:0"><i class="fa-solid fa-scale-balanced"></i> Trial balance sync</h3>' +
            '<span class="sm muted">GL balances grouped by company × account in Fusion → kept on this PC → Statements, Analytics and KPIs</span></div>' +
            (admin ? '' : '<div class="callout warn sm" style="margin-top:8px">An AI admin syncs the finance data on this PC.</div>') +
            '<div class="row" style="margin-top:10px"><label class="sm">Pod <select id="ts-pod"><option value="">Logged-in pod</option><option value="PROD"' + (L.pod === 'PROD' ? ' selected' : '') + '>PROD</option><option value="TEST"' + (L.pod === 'TEST' ? ' selected' : '') + '>TEST</option></select></label>' +
            '<label class="sm">Ledger <select id="ts-led"><option>…</option></select></label>' +
            '<label class="sm">From <select id="ts-from"></select></label><label class="sm">To <select id="ts-to"></select></label>' +
            '<span class="seg" id="ts-quick"><button data-q="ytd" title="From the first period of the fiscal year to the To period">Year to date</button><button data-q="3">Last 3</button><button data-q="1">One period</button></span>' +
            '<span class="sm muted" id="ts-count"></span></div>' +
            '<div class="row" style="margin-top:6px"><span class="sm muted">Companies</span><div id="ts-cos" class="tl-cos"></div></div>' +
            '<div class="row" style="margin-top:6px"><label class="sm"><input type="checkbox" id="ts-cc"' + (L.byCc ? ' checked' : '') + '> by cost centre</label>' +
            '<label class="sm"><input type="checkbox" id="ts-fold"' + (L.fold ? ' checked' : '') + ' title="Adjustment periods (e.g. Adj-25) are read too and added to the period they close"> fold adjustment periods</label>' +
            '<label class="sm" title="Queries to Fusion at the same time (one per company and period)">Reads in parallel <select id="ts-par">' + [1, 2, 3, 4].map(function (n) { return '<option' + (L.par === n ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label>' +
            '<label class="sm" title="Read the periods again even when this PC holds them (after postings)"><input type="checkbox" id="ts-ref"> read again from Fusion</label>' +
            '<button class="btn primary" id="ts-go"' + (admin ? '' : ' disabled') + '><i class="fa-solid fa-cloud-arrow-down"></i> Sync</button></div>' +
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
            '<div class="row"><button class="btn sm" id="ts-test" title="Runs this query in Fusion now for the To period and the first company (read-only) — rows, time and the first rows"><i class="fa-solid fa-play"></i> Test query</button>' +
            '<button class="btn sm" id="tl-qreset"><i class="fa-solid fa-rotate-left"></i> Default query</button><div id="tl-qfix"></div>' +
            '<span class="sm muted">Sync uses this query; your own query is kept on this PC.</span></div><div id="ts-testres"></div></details>' +
            '<div id="fu-prog"></div></div>' +
            '<div class="card" style="margin-top:12px"><div class="row"><h3 style="margin:0"><i class="fa-solid fa-table-cells"></i> Synced on this PC</h3><span class="sm muted" id="ts-from-what"></span><span class="grow"></span>' +
            '<button class="btn sm" id="ts-resync" disabled><i class="fa-solid fa-rotate"></i> Sync selected again</button><button class="btn sm" id="ts-del" disabled><i class="fa-solid fa-trash"></i> Remove selected</button>' +
            '<button class="btn sm primary" id="ts-open"><i class="fa-solid fa-arrow-right"></i> Open the trial balance</button></div><div id="ts-grid" style="margin-top:8px"><div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i></div></div></div>' +
            '<div class="card" style="margin-top:12px" id="ts-names"></div>';
        FL.fusion.paint();
        $('ts-pod').onchange = function () { L.pod = this.value; FL.lsSet('tbl.pod', L.pod); L.ledger = null; T.fillLedgers(); };
        $('ts-cc').onchange = function () { L.byCc = this.checked; FL.lsSet('tbl.byCc', L.byCc); T.loadQ(); if (!L.query) $('tl-qtext').value = L.defaultQuery || T.defaultQ(); };
        $('ts-fold').onchange = function () { L.fold = this.checked; };
        $('ts-par').onchange = function () { L.par = +this.value; FL.lsSet('tbl.par', L.par); };
        $('ts-go').onclick = function () { T.sync(null, !!$('ts-ref').checked); };
        $('ts-open').onclick = function () { FL.stmt.tpl = 'TB'; FL.lsSet('stmt.tpl', 'TB'); FL.show('statements'); };
        el.querySelectorAll('#ts-quick button').forEach(function (b) { b.onclick = function () { T.quick(b.dataset.q); }; });
        $('tl-qtext').oninput = function () { T.qCheck(false); };
        $('ts-test').onclick = function () { T.test(); };
        [].forEach.call(document.querySelectorAll('#tl-qopts input'), function (cb) {
            cb.onchange = function () {
                L.opt[cb.dataset.o] = cb.checked; FL.lsSet('tbl.opt', L.opt);
                if (cb.dataset.o === 'perCompany') return;   // how the query is run, not the query
                var q = L.query; T.loadQ(); L.query = q;
                if (!L.query) { $('tl-qtext').value = L.defaultQuery || T.defaultQ(); T.qCheck(false); }
                else FL.toast('Your own query is used — press Default query to get the default with these options', 'info');
            };
        });
        $('tl-qreset').onclick = function () { L.query = ''; FL.lsSet('tbl.query.account', ''); $('tl-qtext').value = L.defaultQuery || T.defaultQ(); $('tl-qstate').textContent = 'default'; T.qCheck(false); };
        T.qCheck(false);
        T.fillLedgers();
        T.grid();
        T.names();
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
        var per = T.cal().filter(function (p) { return p.seq === L.to; })[0]; if (!per) return;
        var co = L.cos[0] || ((l.companies || [])[0] || {}).value;
        var sql = T.fill($('tl-qtext').value.trim(), per.name, co);
        $('ts-testres').innerHTML = '<div class="sm muted" style="margin-top:6px">' + esc(per.name + (co ? ' · company ' + co : '')) + '</div><div class="fu-runres"></div><pre class="mon-sql">' + esc(sql) + '</pre>';
        FL.fusion.runSql(sql, L.pod || '', $('ts-testres').querySelector('.fu-runres'));
    };

    // ── account names and types (from the segment values: this PC, APEX, or read from Fusion once) ──
    T.names = function () {
        var box = $('ts-names'); if (!box) return;
        var st = FL.status || {};
        if (!st.loaded || (st.meta || {}).source !== 'FUSION_TB') { box.style.display = 'none'; return; }
        box.style.display = '';
        FL.rows("SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE name IS NULL OR name = code) AS noname, COUNT(*) FILTER (WHERE account_type IS NULL) AS notype FROM fin_accounts", 1).then(function (r) {
            var x = r[0] || {}, ok = !x.noname && !x.notype, admin = FL.who && FL.who.admin;
            box.innerHTML = '<div class="row"><h3 style="margin:0"><i class="fa-solid fa-tags"></i> Account names &amp; types</h3><span class="sm ' + (ok ? 'pos' : 'warn') + '">' +
                (ok ? '✓ all ' + x.n + ' accounts have a name and a type' : (x.noname ? x.noname + ' of ' + x.n + ' accounts have no name' : '') + (x.noname && x.notype ? ' · ' : '') + (x.notype ? x.notype + ' have no type (A / L / O / R / E)' : '')) + '</span><span class="grow"></span>' +
                '<button class="btn sm" id="ts-napex"' + (admin ? '' : ' disabled') + ' title="Use the segment values kept in APEX (Data › Chart of accounts)"><i class="fa-solid fa-cloud-arrow-down"></i> From APEX</button>' +
                '<button class="btn sm" id="ts-nfus"' + (admin ? '' : ' disabled') + ' title="Read the account (and company, cost centre) segment values with their description and account type from Fusion once — kept on this PC and in APEX"><i class="fa-solid fa-bolt"></i> Read from Fusion</button></div>' +
                '<p class="sm muted" style="margin:6px 0 0">The trial balance query brings amounts only; names and types come from the segment values. ' + (ok ? '' : 'Read them once and the statements are rebuilt with them.') + '</p>';
            $('ts-napex').onclick = function () { T.namesFrom('apex', this); };
            $('ts-nfus').onclick = function () { T.namesFrom('fusion', this); };
            if (!ok && !T._triedApex) { T._triedApex = true; T.namesFrom('apex', null, true); }   // quietly once: APEX may already have them
        });
    };
    /** The ledger's company / account / cost centre columns → values from APEX or Fusion → this PC (finSegValuesSave / finFusionSegValues), statements rebuilt */
    T.namesFrom = function (where, btn, quiet) {
        var l = T.ledgerObj(); if (!l) { if (!quiet) FL.toast('Pick the ledger above', 'err'); return; }
        var led = FL.fusion.ledgerFor(l, FL.fusion.rolesOf(L.disc)), pod = L.pod || '', coa = l.coaId;
        var cols = [led.account, led.company, led.costCentre].filter(function (c, i, a) { return c && a.indexOf(c) === i; });
        if (btn) btn.disabled = true;
        var p = where === 'fusion' ? FL.fusion.progress('Segment values ' + cols.join(', ') + '…', true) : null;
        var n = 0, chain = Promise.resolve();
        cols.forEach(function (col) {
            chain = chain.then(function () {
                if (where === 'apex') return FL.apexStore.loadSegValues(pod, coa, col).then(function (v) {
                    if (!v.length) return;
                    n += v.length;
                    return FL.call('finSegValuesSave', { coaId: coa, column: col, values: v.map(function (x) { return { value: x.value, description: x.description, accountType: x.accountType, combinations: x.combinations }; }) }, 120000);
                });
                return FL.call('finFusionSegValues', { pod: pod, coaId: coa, column: col }, 20 * 60000, p).then(function (r) {
                    var vals = (r.values || []).map(function (x) { return { value: x.value, description: x.description, accountType: x.accountType, combinations: x.combinations }; });
                    n += vals.length;
                    return FL.apexStore.saveSegValues(pod, coa, col, vals).catch(function () { /* APEX copy is optional */ });
                });
            });
        });
        chain.then(function () {
            if (p) FL.fusion.finish();
            if (!n) { if (!quiet) FL.toast(where === 'apex' ? 'APEX has no segment values for this chart yet — press Read from Fusion' : 'No values came back', 'err'); return; }
            FL.toast(n.toLocaleString() + ' segment values applied — statements rebuilt', 'ok');
            return FL.refresh();
        }).catch(function (e) { if (p) FL.fusion.finish(String(e && e.message || e)); if (!quiet) FL.toast(String(e && e.message || e), 'err'); })
            .then(function () { if (btn) btn.disabled = false; T.names(); });
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
        $('ts-led').innerHTML = '<option>reading the chart of accounts…</option>';
        return FL.fusion.getDisc(pod).then(function (r) {
            if ((L.pod || '') !== pod || !$('ts-led')) return;
            if (!r) { L.disc = null; $('ts-led').innerHTML = '<option value="">— discover first —</option>'; $('ts-cos').innerHTML = '<span class="sm">Nothing discovered for ' + esc(pod || 'the logged-in pod') + ' — <a onclick="FL.dataTab.dataSetup()">Discover the ledgers</a> once (Data › Fusion setup).</span>'; return; }
            L.disc = r.disc;
            var leds = (r.disc.ledgers || []).filter(function (l) { return l.coaId; }), def = FL.fusion.defaultIds(r.disc);
            if (!leds.some(function (l) { return String(l.id) === String(L.ledger); })) L.ledger = def[0] || (leds[0] && String(leds[0].id));
            $('ts-led').innerHTML = leds.map(function (l) { return '<option value="' + esc(l.id) + '"' + (String(l.id) === String(L.ledger) ? ' selected' : '') + '>' + esc(l.name + ' · ' + l.currency + (l.category && l.category !== 'PRIMARY' ? ' · ' + l.category.toLowerCase() : '')) + '</option>'; }).join('');
            $('ts-led').onchange = function () { L.ledger = this.value; FL.lsSet('tbl.ledger', L.ledger); L.cos = []; T.fillPeriods(); };
            T.fillPeriods();
        });
    };
    T.ledgerObj = function () { return L.disc ? (L.disc.ledgers || []).filter(function (l) { return String(l.id) === String(L.ledger); })[0] : null; };
    T.cal = function () { var l = T.ledgerObj(); return l ? FL.fusion.calOf(L.disc, l) : []; };
    T.fillPeriods = function () {
        var l = T.ledgerObj(); if (!l) return;
        var cal = T.cal(), today = new Date().toISOString().slice(0, 10), started = cal.filter(function (p) { return !p.start || p.start <= today; });
        var last = started.length ? started[started.length - 1] : cal[cal.length - 1];
        if (!cal.some(function (p) { return p.seq === L.to; })) L.to = last && last.seq;
        if (!cal.some(function (p) { return p.seq === L.from; })) { var fy = cal.filter(function (p) { return last && Math.floor(p.seq / 100) === Math.floor(last.seq / 100); })[0]; L.from = (fy || last || {}).seq; }
        var opts = function (sel) { return cal.slice().reverse().map(function (p) { return '<option value="' + p.seq + '"' + (p.seq === sel ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join(''); };
        $('ts-from').innerHTML = opts(L.from); $('ts-to').innerHTML = opts(L.to);
        $('ts-from').onchange = function () { L.from = +this.value; if (L.from > L.to) { L.to = L.from; $('ts-to').value = L.to; } T.count(); };
        $('ts-to').onchange = function () { L.to = +this.value; if (L.from > L.to) { L.from = L.to; $('ts-from').value = L.from; } T.count(); };
        var cos = l.companies || [];
        $('ts-cos').innerHTML = cos.length ? '<label class="chip"><input type="checkbox" id="ts-all"' + (L.cos.length ? '' : ' checked') + '> all ' + cos.length + '</label>' + cos.map(function (c) {
            return '<label class="chip"><input type="checkbox" class="ts-co" value="' + esc(c.value) + '"' + (L.cos.indexOf(c.value) >= 0 ? ' checked' : '') + '> ' + esc(c.value) + (c.legalEntity ? ' <span class="muted">' + esc(c.legalEntity) + '</span>' : '') + '</label>';
        }).join('') : '<span class="sm muted">every company of the ledger</span>';
        var pick = function () { L.cos = Array.prototype.map.call(document.querySelectorAll('.ts-co:checked'), function (c) { return c.value; }); if ($('ts-all')) $('ts-all').checked = !L.cos.length; T.count(); };
        document.querySelectorAll('.ts-co').forEach(function (c) { c.onchange = pick; });
        if ($('ts-all')) $('ts-all').onchange = function () { if (this.checked) { document.querySelectorAll('.ts-co').forEach(function (c) { c.checked = false; }); L.cos = []; } else this.checked = !L.cos.length; T.count(); };
        T.count();
    };
    T.range = function () { return T.cal().filter(function (p) { return p.seq >= L.from && p.seq <= L.to; }); };
    T.count = function () {
        var n = T.range().length, l = T.ledgerObj(), c = L.cos.length || (l && l.companies || []).length || 1;
        if ($('ts-count')) $('ts-count').textContent = n + ' period(s)' + (L.opt.perCompany ? ' × ' + c + ' compan' + (c === 1 ? 'y' : 'ies') + ' = up to ' + n * c + ' queries (only what this PC is missing)' : '');
    };
    T.quick = function (q) {
        var cal = T.cal(), to = cal.filter(function (p) { return p.seq === L.to; })[0]; if (!to) return;
        if (q === 'ytd') L.from = cal.filter(function (p) { return Math.floor(p.seq / 100) === Math.floor(to.seq / 100); })[0].seq;
        else { var i = cal.indexOf(to); L.from = cal[Math.max(0, i - (+q - 1))].seq; }
        $('ts-from').value = L.from; T.count();
    };

    // ── sync ──
    /** seqs: the periods to sync (default = From–To); refresh: read again even when this PC has them */
    T.sync = function (seqs, refresh) {
        var l = T.ledgerObj(); if (!l) { FL.toast('Pick a ledger', 'err'); return; }
        var led = FL.fusion.ledgerFor(l, FL.fusion.rolesOf(L.disc));
        if (!led.company || !led.account) { FL.toast('The company / account segment of chart ' + l.coaId + ' is not set — Data › Fusion setup', 'err'); return; }
        var list = seqs || T.range().map(function (p) { return p.seq; });
        if (!list.length) { FL.toast('Pick the periods', 'err'); return; }
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
        var p = FL.fusion.progress('Trial balance sync ' + l.name + ' · ' + names[0] + (names.length > 1 ? ' – ' + names[names.length - 1] : '') + '…', true);
        FL.fusion.run.pod = L.pod || '';
        if ($('ts-go')) $('ts-go').disabled = true;
        FL.call('finTbSync', { pod: L.pod || '', options: { ledger: led, periodSeqs: list, foldAdjustments: L.fold, companies: L.cos, byCostCentre: L.byCc, parallel: L.par, refresh: !!refresh, queryTemplate: L.query || '',
            skipZero: !!L.opt.skipZero, allSums: !!L.opt.allSums, hint: !!L.opt.hint, perCompany: L.opt.perCompany !== false, allCompanies: (l.companies || []).map(function (c) { return c.value; }) } }, 60 * 60000, p).then(function (r) {
            FL.fusion.finish();
            if (r.defaultTemplate) { L.defaultQuery = r.defaultTemplate; FL.lsSet('tbl.dq.' + T.qKey(), r.defaultTemplate); if ($('tl-qtext') && !L.query) $('tl-qtext').value = r.defaultTemplate; }
            var b = r.built || {};
            FL.toast(names.length + ' period(s) synced' + (b.built ? ' — the statements now use ' + b.periods + ' synced period(s)' : b.reason === 'full load' ? ' — kept beside the full load the statements use' : ''), 'ok');
            return FL.refresh();
        }).catch(function (e) { FL.fusion.finish(String(e && e.message || e)); }).then(function () { if ($('ts-go')) $('ts-go').disabled = !(FL.who && FL.who.admin); T.grid(); });
    };

    // ── what is synced: ledger × period ──
    T.grid = function () {
        var box = $('ts-grid'); if (!box) return;
        FL.call('finTbSyncStatus').then(function (r) {
            L.status = r; L.sel = {};
            var rows = (r.rows || []).filter(function (x) { return x.seq != null; });
            if ($('ts-from-what')) $('ts-from-what').textContent = r.statementsFrom === 'FUSION_TB' ? '· the statements use these periods' : r.statementsFrom && r.statementsFrom !== 'none' ? '· the statements use the full load (' + r.statementsFrom + '); these are kept beside it' : '';
            if (!rows.length) { box.innerHTML = '<p class="sm muted">Nothing synced yet — pick the ledger and the periods above and press Sync.</p>'; T.selChanged(); return; }
            // one row per pod × ledger, one column per normal period; a cell = companies read (all or n of m), rows, adjustment periods folded in
            var leds = {}, seqs = {};
            rows.forEach(function (x) {
                var k = (x.pod || '') + '|' + x.ledgerId, g = leds[k] = leds[k] || { pod: x.pod || '', ledgerId: x.ledgerId, code: x.ledger, name: x.ledgerName || x.ledger || x.ledgerId, currency: x.currency, cells: {} };
                var c = g.cells[x.seq] = g.cells[x.seq] || { seq: x.seq, names: {}, cos: {}, all: false, rows: 0, at: '', grains: {}, adj: [] };
                c.names[x.period] = 1; c.rows += +x.rows || 0; c.grains[x.grain] = 1; if (x.adj) c.adj.push(x.period); else c.name = x.period;
                if (x.companies === '*') c.all = true; else String(x.companies || '').split(',').forEach(function (v) { if (v) c.cos[v] = 1; });
                if (String(x.at) > c.at) c.at = String(x.at);
                seqs[x.seq] = c.name || seqs[x.seq] || x.period;
            });
            var cols = Object.keys(seqs).map(Number).sort(function (a, b) { return b - a; });
            var discLeds = {}; ((L.disc && L.disc.ledgers) || []).forEach(function (l) { discLeds[String(l.id)] = l; });
            box.innerHTML = '<div class="scroll"><table class="t ts-grid"><thead><tr><th>Ledger</th>' + cols.map(function (s) { return '<th class="c">' + esc(seqs[s]) + '</th>'; }).join('') + '</tr></thead><tbody>' +
                Object.keys(leds).map(function (k) {
                    var g = leds[k], total = ((discLeds[String(g.ledgerId)] || {}).companies || []).length;
                    return '<tr><td><b>' + esc(g.name) + '</b><div class="sm muted">' + esc((g.pod || 'logged-in pod') + ' · ' + (g.currency || '')) + '</div></td>' + cols.map(function (s) {
                        var c = g.cells[s]; if (!c) return '<td class="c muted">·</td>';
                        var n = Object.keys(c.cos).length, full = c.all || (total && n >= total);
                        var tip = (c.name || '') + (c.adj.length ? ' + ' + c.adj.join(', ') : '') + '\n' + (c.all ? 'every company' : 'companies ' + Object.keys(c.cos).join(', ')) + '\n' + c.rows.toLocaleString() + ' rows · ' +
                            Object.keys(c.grains).map(function (gr) { return gr === 'CO,AC,CC' ? 'by cost centre' : 'company × account'; }).join(' + ') + '\nread ' + c.at.slice(0, 16);
                        return '<td class="c ts-cell ' + (full ? 'full' : 'part') + '" data-k="' + esc(k) + '" data-s="' + s + '" title="' + esc(tip) + '">' + (full ? '✓' : n + (total ? '/' + total : '')) + (c.grains['CO,AC,CC'] ? '<sup>cc</sup>' : '') + '</td>';
                    }).join('') + '</tr>';
                }).join('') + '</tbody></table></div><p class="sm muted">✓ = every company · n/m = some companies · <sup>cc</sup> = by cost centre. Click cells to select them for Sync again / Remove.</p>';
            T.leds = leds;
            box.querySelectorAll('.ts-cell').forEach(function (td) {
                td.onclick = function () { var key = td.dataset.k + '§' + td.dataset.s; if (L.sel[key]) delete L.sel[key]; else L.sel[key] = 1; td.classList.toggle('sel', !!L.sel[key]); T.selChanged(); };
            });
            T.selChanged();
        }).catch(function (e) { box.innerHTML = '<div class="callout bad">' + esc(e) + '</div>'; });
    };
    T.selChanged = function () {
        var n = Object.keys(L.sel).length, admin = FL.who && FL.who.admin;
        if ($('ts-resync')) { $('ts-resync').disabled = !n || !admin; $('ts-resync').innerHTML = '<i class="fa-solid fa-rotate"></i> Sync ' + (n ? n + ' ' : '') + 'selected again'; }
        if ($('ts-del')) $('ts-del').disabled = !n || !admin;
        if ($('ts-resync')) $('ts-resync').onclick = function () {
            var byLed = T.bySel(), keys = Object.keys(byLed);
            if (keys.length !== 1) { FL.toast('Select periods of one ledger to sync again', 'err'); return; }
            var g = T.leds[keys[0]];
            if ((g.pod || '') !== (L.pod || '') || String(g.ledgerId) !== String(L.ledger)) { FL.toast('Pick ' + g.name + ' (' + (g.pod || 'logged-in pod') + ') above first', 'err'); return; }
            T.sync(byLed[keys[0]], true);
        };
        if ($('ts-del')) $('ts-del').onclick = function () {
            var byLed = T.bySel();
            if (!confirm('Remove the selected synced periods from this PC? The statements are rebuilt from the periods that stay.')) return;
            Promise.all(Object.keys(byLed).map(function (k) {
                var g = T.leds[k], names = [];
                byLed[k].forEach(function (s) { names = names.concat(Object.keys(g.cells[s].names)); });
                return FL.call('finTbSyncDelete', { pod: g.pod, ledgerId: +g.ledgerId, periods: names }, 120000);
            })).then(function () { FL.toast('Removed', 'ok'); return FL.refresh(); }).catch(function (e) { FL.toast(String(e), 'err'); }).then(T.grid);
        };
    };
    T.bySel = function () { var m = {}; Object.keys(L.sel).forEach(function (x) { var p = x.split('§'); (m[p[0]] = m[p[0]] || []).push(+p[1]); }); return m; };
})();
