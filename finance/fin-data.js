/* Finance Lens — the Data workspace: where the numbers come from and whether they still match Fusion.
   Views: Sync status (ledger × month grid: Fusion fingerprint vs this PC — in sync / changed / new / not tying; one-click
   sync of changed, new or open periods, or any single period, optionally split by GL account), Chart of accounts (segments
   per chart with roles and evidence, and every value of each segment: description, use, account type), Fusion setup (the
   SQL load wizard, fin-fusion.js), BICC bulk extracts (files from a folder or the pod's UCM → DuckDB in one pass), Account
   mapping, SQL explorer, Data & folder.
   Host actions: finFusionCheck, finFusionSync (periodSeqs / kinds / splitBy), finFusionSegValues, finSegValues,
   finBiccInspect, finBiccLoad, finUcmList, finUcmDownload (classes/FinanceFusion.cs, FinanceBicc.cs). */
(function () {
    var D = FL.dataTab = { view: FL.ls('data.view', 'tbsync'), check: FL.ls('fusion.check', null), seg: null, segVals: null, ucm: null, biccRes: null };
    var VIEWS = [
        ['tbsync', 'fa-scale-balanced', 'Trial balance sync', 'ledger × periods → statements'],
        ['setup', 'fa-sliders', 'Fusion setup', 'ledgers, chart of accounts roles'],
        ['coa', 'fa-sitemap', 'Chart of accounts', 'segments and their values'],
        ['status', 'fa-layer-group', 'Full GL load', 'all balances + journals, month check'],
        ['bicc', 'fa-boxes-stacked', 'BICC bulk extracts', 'all balances & journals at once'],
        ['mapping', 'fa-diagram-project', 'Account mapping', 'account → statement line'],
        ['sql', 'fa-terminal', 'SQL explorer', 'read-only DuckDB SQL'],
        ['settings', 'fa-gear', 'Data & folder', 'file, folder, remove']
    ];
    var ST = {
        OK: ['ok', 'In sync', 'Same as Fusion: nothing posted since it was read, debits and credits tie to the cent'],
        CHANGED: ['chg', 'Changed in Fusion', 'Posted or changed in Fusion since it was read — sync it again'],
        NEW: ['new', 'New in Fusion', 'Fusion has balances for this month, this PC has none'],
        DIFF: ['diff', 'Does not tie', 'The totals on this PC differ from Fusion'],
        EMPTY: ['none0', 'Nothing in Fusion', 'No balances / posted journals in Fusion'],
        NOT_LOADED: ['nl', 'Not loaded', 'Journals of this month are not loaded (only the last N months are)'],
        LOADED: ['loaded', 'Loaded', 'Loaded — press Check Fusion to compare']
    };
    var sv = function () { return FL.fusion.saved() || null; };
    var money = function (v) { return v == null ? '' : FINE.fmt(+v, 'num', { decimals: 2 }); };

    FL.TABS.data = {
        render: function (el) {
            if (!VIEWS.some(function (v) { return v[0] === D.view; })) D.view = 'tbsync';
            el.innerHTML = '<div class="split"><div class="side">' + VIEWS.map(function (v) {
                return '<div class="item' + (v[0] === D.view ? ' on' : '') + '" data-v="' + v[0] + '"><i class="fa-solid ' + v[1] + '"></i><div>' + v[2] + '<small>' + v[3] + '</small></div></div>';
            }).join('') + '</div><div id="dt-main"></div></div>';
            el.querySelectorAll('.side .item').forEach(function (it) { it.onclick = function () { D.view = it.dataset.v; FL.lsSet('data.view', D.view); FL.TABS.data.render(el); }; });
            var main = $('dt-main');
            return Promise.resolve(D[D.view](main)).catch(function (e) { main.innerHTML = '<div class="callout bad">' + esc(e && e.message || e) + '</div>'; });
        }
    };

    // ═════════ Trial balance sync (fin-tbsync.js) ═════════
    D.tbsync = function (el) { return FL.tbsync.render(el); };

    // ═════════ Full GL load (sync status) ═════════
    D.status = function (el) {
        var st = FL.status || {}, m = st.meta || {}, c = st.counts || {}, s = sv();
        var kpi = function (l, v, sub) { return '<div class="kpi"><div class="k-l">' + esc(l) + '</div><div class="k-v" style="font-size:1.05rem">' + esc(v) + '</div>' + (sub ? '<div class="sm muted">' + esc(sub) + '</div>' : '') + '</div>'; };
        var h = '<div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">' +
            kpi('Source', st.loaded ? (m.source === 'FUSION' ? 'Oracle Fusion' + (m.loader === 'BICC' ? ' · BICC' : ' · SQL') : m.source === 'FUSION_TB' ? 'Synced trial balances' : m.source || '?') : 'nothing loaded', m.pod ? 'pod ' + m.pod : '') +
            kpi('Last load', st.loaded ? String(m.loaded_at || '').replace('T', ' ').slice(0, 16) : '—', m.load_mode || '') +
            kpi('Ledgers', (FL.dims.ledgers || []).length || (st.loaded ? 1 : 0), (FL.dims.ledgers || []).map(function (l) { return l.code + ' ' + l.currency; }).join(' · ')) +
            kpi('Periods', st.loaded ? (c.first_period || '') + ' – ' + (c.last_period || '') : '—', FL.dims.periods.length + ' months') +
            kpi('Balances', (c.balances || 0).toLocaleString(), (c.accounts || 0).toLocaleString() + ' accounts') +
            kpi('Journal lines', (c.journals || 0).toLocaleString(), m.journals_from_seq ? 'from ' + FL.periodName(+m.journals_from_seq) : '') + '</div>';
        // the live monitor first (what runs in Fusion now, sample rows, log), then the load form, then the month grid
        var admin = FL.who && FL.who.admin, pod = D.pod != null ? D.pod : ((s && s.setup && s.setup.pod) || (s && s.pod) || '');
        D.pod = pod;
        var open = D.loadOpen != null ? D.loadOpen : !(s && s.ledgers && st.loaded);
        h += '<div id="fu-prog"></div>' +
            '<details class="card lf-card" id="ds-load"' + (open ? ' open' : '') + ' style="margin-top:12px"><summary><b><i class="fa-solid fa-cloud-arrow-down"></i> Load from Fusion</b> <span class="sm muted">choose the ledgers and months, then watch the SQL run above</span></summary>' +
            '<div class="row" style="margin:8px 0"><label class="sm">Pod <select id="ds-pod"><option value="">Logged-in pod</option><option value="PROD"' + (pod === 'PROD' ? ' selected' : '') + '>PROD</option><option value="TEST"' + (pod === 'TEST' ? ' selected' : '') + '>TEST</option></select></label>' +
            '<span class="sm muted" id="ds-disc"></span><span class="grow"></span><a class="sm" onclick="FL.dataTab.go(\'setup\')"><i class="fa-solid fa-sliders"></i> segments &amp; discovery (Fusion setup)</a></div><div id="ds-lf"><div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i></div></div></details>';
        if (!s || !s.ledgers) {
            el.innerHTML = h + '<div class="card" style="margin-top:12px"><h3><i class="fa-solid fa-signal"></i> Which months are in sync with Fusion</h3><p class="sm muted">Nothing loaded yet — the month grid fills with the first load. Or load everything at once from <a onclick="FL.dataTab.go(\'bicc\')">BICC bulk extracts</a>.</p></div>';
            D.wireLoad(admin);
            FL.fusion.paint();
            return;
        }
        var chk = D.check, when = chk ? String(chk.checkedAt || '').replace('T', ' ').slice(0, 16) : null;
        h += '<div class="card" style="margin-top:12px"><div class="row"><h3 style="margin:0"><i class="fa-solid fa-signal"></i> Which months are in sync with Fusion</h3><span class="grow"></span>' +
            '<span class="sm muted">' + (when ? 'checked ' + esc(when) : 'not checked yet') + '</span>' +
            '<button class="btn primary" id="ds-check" title="One small query per ledger and year: rows, debits, credits and last update of every month in Fusion, compared with what this PC holds"><i class="fa-solid fa-magnifying-glass-chart"></i> Check Fusion now</button></div>' +
            '<div class="row" style="margin:10px 0"><button class="btn" id="ds-chg"' + (chk ? '' : ' disabled') + '><i class="fa-solid fa-rotate"></i> Sync changed &amp; new months</button>' +
            '<button class="btn" id="ds-open"' + (chk ? '' : ' disabled') + '><i class="fa-solid fa-lock-open"></i> Sync open periods</button>' +
            '<button class="btn" id="ds-one"><i class="fa-solid fa-calendar-day"></i> Sync one period…</button>' +
            '<label class="sm">split each read <select id="ds-split"><option value="">as set up (' + esc(s.splitBy || 'none') + ')</option><option value="none">no</option><option value="account">by GL account ranges</option><option value="company">by company</option></select></label>' +
            '<span class="grow"></span>' + Object.keys(ST).filter(function (k) { return k !== 'LOADED' || !chk; }).map(function (k) { return '<span class="lg"><i class="cell ' + ST[k][0] + '"></i>' + ST[k][1] + '</span>'; }).join('') + '</div>' +
            '<div id="ds-grid"><div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i></div></div></div>';
        el.innerHTML = h;
        $('ds-check').onclick = function () { D.runCheck(); };
        $('ds-chg').onclick = function () { D.syncChanged(); };
        $('ds-open').onclick = function () { D.syncOpen(); };
        $('ds-one').onclick = function () { D.pickPeriod(); };
        D.wireLoad(admin);
        FL.fusion.paint();
        return D.grid();
    };
    /** The load form inside Sync status: discovery of the chosen pod (this session / APEX / DuckDB) → ledgers + months */
    D.wireLoad = function (admin) {
        var det = $('ds-load'); if (!det) return;
        det.addEventListener('toggle', function () { D.loadOpen = det.open; });
        $('ds-pod').onchange = function () { D.pod = this.value; D.wireLoad(admin); };
        var box = $('ds-lf');
        if (!admin) { box.innerHTML = '<p class="sm">An AI admin loads the finance data from Fusion; this page shows its progress and which months are in sync.</p>'; return; }
        box.innerHTML = '<div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i> Reading the saved chart of accounts…</div>';
        var pod = D.pod || '';
        FL.fusion.getDisc(pod).then(function (r) {
            if (!$('ds-lf') || (D.pod || '') !== pod) return;
            if (!r) { box.innerHTML = '<p class="sm">Nothing discovered for ' + esc(pod || 'the logged-in pod') + ' yet — <a onclick="FL.dataTab.dataSetup()">Discover the ledgers and chart of accounts</a> once (Fusion setup); the result is kept in APEX and DuckDB.</p>'; $('ds-disc').textContent = ''; return; }
            $('ds-disc').textContent = 'chart of accounts from ' + (r.where || 'APEX') + (r.at ? ' · discovered ' + String(r.at).replace('T', ' ').slice(0, 16) : '') + ' · ' + (r.disc.ledgers || []).length + ' ledgers';
            box.innerHTML = FL.fusion.loadForm(r.disc);
            FL.fusion.wireLoadForm(box, r.disc);
        });
    };
    D.dataSetup = function () { FL.fusion.editing = true; D.go('setup'); };
    D.go = function (v) { D.view = v; FL.lsSet('data.view', v); FL.render(); };
    D.split = function () { var e = $('ds-split'); return e && e.value ? e.value : null; };

    /** The grid: from the last check, else from what this PC holds (fin_sync_periods) */
    D.grid = function () {
        var box = $('ds-grid'); if (!box) return;
        var s = sv(), chk = D.check;
        var p = chk ? Promise.resolve({ periods: chk.periods, cells: chk.cells }) : FL.rows("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_name = 'fin_sync_periods'").then(function (r) {
            if (!r[0] || !r[0].n) return { periods: [], cells: [] };
            return FL.rows("SELECT ledger, period_seq, period_name, kind, rows_read, rows_local, dr, cr, CAST(synced_at AS VARCHAR) AS synced, ms, split FROM fin_sync_periods", 100000).then(function (rows) {
                var per = {}, cells = {};
                rows.forEach(function (r) {
                    per[r.period_seq] = r.period_name;
                    var c = cells[r.ledger + '|' + r.period_seq] = cells[r.ledger + '|' + r.period_seq] || { ledger: r.ledger, seq: r.period_seq, period: r.period_name, bal: { status: 'EMPTY' }, jnl: { status: 'NOT_LOADED' } };
                    var k = r.kind === 'BAL' ? 'bal' : r.kind === 'JNL' ? 'jnl' : null;
                    if (k) c[k] = { status: 'LOADED', local: { dr: r.dr, cr: r.cr, n: r.rows_local }, synced: r.synced, rows: r.rows_read, ms: r.ms, split: r.split };
                });
                return { periods: Object.keys(per).sort().map(function (q) { return { seq: +q, name: per[q] }; }), cells: Object.keys(cells).map(function (k) { return cells[k]; }) };
            });
        });
        return p.then(function (g) {
            if (!g.periods.length) { box.innerHTML = '<p class="sm muted">Nothing recorded yet — the next load (or Check Fusion) fills this grid.</p>'; return; }
            var leds = (s.ledgers || []).map(function (l) { return { code: l.code || String(l.id), name: l.name, currency: l.currency }; });
            var by = {}; g.cells.forEach(function (c) { by[c.ledger + '|' + c.seq] = c; });
            var years = {}; g.periods.forEach(function (p) { var y = Math.floor(p.seq / 100); (years[y] = years[y] || []).push(p); });
            var open = {}; g.cells.forEach(function (c) { if (c.closing === 'O') open[c.seq] = 1; });
            var count = {}; g.cells.forEach(function (c) { count[c.bal.status] = (count[c.bal.status] || 0) + 1; });
            var h = '<div class="sm" style="margin-bottom:6px">' + Object.keys(count).map(function (k) { return '<span class="lg"><i class="cell ' + (ST[k] || ST.LOADED)[0] + '"></i>' + count[k] + ' ' + (ST[k] || ST.LOADED)[1].toLowerCase() + '</span>'; }).join('') + '</div>' +
                '<div class="scroll"><table class="sgrid"><thead><tr><th rowspan="2">Ledger</th><th rowspan="2"></th>' +
                Object.keys(years).map(function (y) { return '<th colspan="' + years[y].length + '" class="yr">' + y + '</th>'; }).join('') + '</tr><tr>' +
                g.periods.map(function (p) { return '<th class="mo' + (open[p.seq] ? ' open' : '') + '" title="' + esc(p.name) + (open[p.seq] ? ' · open period' : '') + '">' + esc(String(p.name).slice(0, 3)) + '</th>'; }).join('') + '</tr></thead><tbody>';
            leds.forEach(function (l) {
                ['bal', 'jnl'].forEach(function (k, i) {
                    h += '<tr>' + (i === 0 ? '<td rowspan="2" class="ln"><b>' + esc(l.name) + '</b><div class="sm muted">' + esc(l.code + ' · ' + (l.currency || '')) + '</div></td>' : '') + '<td class="kd">' + (k === 'bal' ? 'Balances' : 'Journals') + '</td>' +
                        g.periods.map(function (p) {
                            var c = by[l.code + '|' + p.seq], x = c ? c[k] : null, stt = x ? x.status : (k === 'bal' ? 'EMPTY' : 'NOT_LOADED'), def = ST[stt] || ST.LOADED;
                            return '<td><i class="cell ' + def[0] + '" data-l="' + esc(l.code) + '" data-s="' + p.seq + '" data-k="' + k + '" title="' + esc(p.name + ' · ' + def[1] + (x && x.synced ? ' · read ' + String(x.synced).replace('T', ' ').slice(0, 16) : '')) + '"></i></td>';
                        }).join('') + '</tr>';
                });
            });
            box.innerHTML = h + '</tbody></table></div><p class="sm muted">Click a month for the numbers behind it and to sync just that month. Open periods are underlined.</p>';
            D.cells = by;
            box.querySelectorAll('i.cell[data-s]').forEach(function (i) { i.onclick = function () { D.cellDialog(i.dataset.l, +i.dataset.s, i.dataset.k); }; });
        });
    };

    D.runCheck = function (silent) {
        var s = sv(); if (!s) return;
        var p = FL.fusion.progress('Checking Fusion…', true);
        return FL.call('finFusionCheck', { pod: s.pod || '', options: { ledgers: s.ledgers, fromSeq: s.fromSeq || 0, toSeq: 0, foldAdjustments: s.foldAdjustments !== false } }, 30 * 60000, p).then(function (r) {
            D.check = r; try { FL.lsSet('fusion.check', r); } catch (e) { /* too big for storage */ }
            FL.fusion.finish();
            if (FL.tab === 'data' && D.view === 'status') FL.render();
            if (!silent) {
                var n = r.cells.filter(function (c) { return c.bal.status !== 'OK' && c.bal.status !== 'EMPTY'; }).length;
                FL.toast(n ? n + ' ledger-month(s) need a sync' : 'Every month is in sync with Fusion', n ? '' : 'ok');
            }
        }).catch(function (e) { FL.fusion.finish(e); });
    };
    var afterSync = function () { if (D.check) D.runCheck(true); };

    D.syncChanged = function () {
        var c = D.check; if (!c) return;
        var bal = {}, jnl = {};
        c.cells.forEach(function (x) {
            if (['CHANGED', 'NEW', 'DIFF'].indexOf(x.bal.status) >= 0) bal[x.seq] = 1;
            if (['CHANGED', 'DIFF'].indexOf(x.jnl.status) >= 0) jnl[x.seq] = 1;
        });
        var seqs = Object.keys(bal).concat(Object.keys(jnl)).map(Number).filter(function (v, i, a) { return a.indexOf(v) === i; }).sort();
        if (!seqs.length) { FL.toast('Nothing to sync — every month matches Fusion', 'ok'); return; }
        var kinds = (Object.keys(bal).length ? ['bal'] : []).concat(Object.keys(jnl).length ? ['jnl'] : []);
        if (!confirm('Sync ' + seqs.length + ' month(s) from Fusion: ' + seqs.map(FL.periodName).join(', ') + ' (' + kinds.map(function (k) { return k === 'bal' ? 'balances' : 'journals'; }).join(' + ') + ')?')) return;
        FL.fusion.afterSync = afterSync;
        FL.fusion.syncPeriods(seqs, kinds, D.split());
    };
    D.syncOpen = function () {
        var c = D.check; if (!c) return;
        var seqs = c.cells.filter(function (x) { return x.closing === 'O'; }).map(function (x) { return x.seq; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).sort();
        if (!seqs.length) { FL.toast('No open periods in the checked range', 'err'); return; }
        var s = sv(), kinds = ['bal'].concat(s && s.journalMonths ? ['jnl'] : []);
        if (!confirm('Sync the open period(s) ' + seqs.map(function (q) { return (D.check.periods.filter(function (p) { return p.seq === q; })[0] || {}).name || q; }).join(', ') + '?')) return;
        FL.fusion.afterSync = afterSync;
        FL.fusion.syncPeriods(seqs, kinds, D.split());
    };
    D.pickPeriod = function () {
        var s = sv(), cal = (s && s.calendar) || [];
        FL.modal('<i class="fa-solid fa-calendar-day"></i> Sync one period', '<div class="row"><label>Period <select id="pp-p">' + cal.slice().reverse().map(function (p) { return '<option value="' + p.seq + '">' + esc(p.name) + '</option>'; }).join('') + '</select></label>' +
            '<label><input type="checkbox" id="pp-b" checked> balances</label><label><input type="checkbox" id="pp-j"' + (s && s.journalMonths ? ' checked' : '') + '> journal lines</label>' +
            '<label>split <select id="pp-s"><option value="">as set up</option><option value="none">no</option><option value="account">by GL account ranges</option><option value="company">by company</option></select></label></div>' +
            '<p class="sm muted">Reads only this month (adjustment periods folded in) for every loaded ledger; the other months stay as they are. The progress and the log show on the status page.</p>',
            '<button class="btn primary sm" id="pp-go"><i class="fa-solid fa-rotate"></i> Sync</button>');
        $('pp-go').onclick = function () {
            var kinds = ($('pp-b').checked ? ['bal'] : []).concat($('pp-j').checked ? ['jnl'] : []), seq = +$('pp-p').value, sp = $('pp-s').value || null;
            if (!kinds.length) return;
            FL.closeModal();
            FL.fusion.afterSync = afterSync;
            FL.fusion.syncPeriods([seq], kinds, sp);
            return;
            FL.fusion.syncPeriods([+$('pp-p').value], kinds, $('pp-s').value || null);
        };
    };
    D.cellDialog = function (led, seq, kind) {
        var c = (D.cells || {})[led + '|' + seq] || {}, b = c.bal || {}, j = c.jnl || {}, s = sv();
        var row = function (l, f, loc) { return '<tr><td class="muted">' + esc(l) + '</td><td class="n">' + esc(f == null ? '' : f) + '</td><td class="n">' + esc(loc == null ? '' : loc) + '</td></tr>'; };
        var stat = function (x) { var d = ST[x.status] || ST.LOADED; return '<span class="lg"><i class="cell ' + d[0] + '"></i><b>' + d[1] + '</b></span> <span class="sm muted">' + d[2] + '</span>'; };
        var html = '<p class="sm">' + esc(led) + ' · ' + esc(c.period || FL.periodName(seq)) + (c.closing ? ' · period ' + ({ O: 'open', C: 'closed', F: 'future', N: 'never opened', P: 'permanently closed' }[c.closing] || c.closing) : '') + '</p>' +
            '<h4>Balances</h4><div>' + stat(b) + '</div><table class="t" style="margin:6px 0"><thead><tr><th></th><th class="n">Fusion</th><th class="n">This PC</th></tr></thead><tbody>' +
            row('Debits', b.fusion ? money(b.fusion.dr) : '', b.local ? money(b.local.dr) : '') + row('Credits', b.fusion ? money(b.fusion.cr) : '', b.local ? money(b.local.cr) : '') +
            row('Rows', b.fusion ? (b.fusion.n || 0).toLocaleString() : '', b.rows ? (+b.rows).toLocaleString() + ' read' : '') + row('Last update / read', b.fusion ? b.fusion.upd : '', b.synced ? String(b.synced).replace('T', ' ').slice(0, 19) : '') +
            (b.ms ? row('Read in', '', (b.ms / 1000).toFixed(1) + ' s' + (b.split && b.split !== 'none' ? ' · split by ' + b.split : '')) : '') + '</tbody></table>' +
            '<h4>Journals</h4><div>' + stat(j) + '</div><table class="t" style="margin:6px 0"><thead><tr><th></th><th class="n">Fusion</th><th class="n">This PC</th></tr></thead><tbody>' +
            row('Posted journals', j.fusion ? (j.fusion.n || 0).toLocaleString() : '', j.local ? (j.local.n || 0).toLocaleString() : '') + row('Debits', j.fusion && j.fusion.dr ? money(j.fusion.dr) : '', j.local ? money(j.local.dr) : '') +
            row('Last update / read', j.fusion ? j.fusion.upd : '', j.synced ? String(j.synced).replace('T', ' ').slice(0, 19) : '') + '</tbody></table>' +
            '<div class="row"><label class="sm">split <select id="cd-s"><option value="">as set up (' + esc((s && s.splitBy) || 'none') + ')</option><option value="none">no</option><option value="account">by GL account ranges</option><option value="company">by company</option></select></label></div>';
        FL.modal('<i class="fa-solid fa-calendar-check"></i> ' + esc(c.period || FL.periodName(seq)), html,
            '<button class="btn sm" id="cd-b">Sync balances</button><button class="btn sm" id="cd-j">Sync journals</button><button class="btn primary sm" id="cd-bj">Sync both</button>' +
            (b.local ? '<button class="btn sm" id="cd-tb">Trial balance</button>' : ''));
        var go = function (kinds) { var sp = $('cd-s').value || null; FL.closeModal(); FL.fusion.afterSync = afterSync; FL.fusion.syncPeriods([seq], kinds, sp); };
        $('cd-b').onclick = function () { go(['bal']); }; $('cd-j').onclick = function () { go(['jnl']); }; $('cd-bj').onclick = function () { go(['bal', 'jnl']); };
        if ($('cd-tb')) $('cd-tb').onclick = function () { FL.closeModal(); FL.filter.period = seq; $('f-period').value = seq; FL.filter.ledger = led; if ($('f-ledger')) $('f-ledger').value = led; FL.lsSet('filter', FL.filter); FL.cache = {}; FL.stmt.tpl = 'TB'; FL.lsSet('stmt.tpl', 'TB'); FL.show('statements'); };
    };

    // ═════════ Chart of accounts ═════════
    D.coa = function (el) {
        var s = sv();
        el.innerHTML = '<div class="card"><div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i>Loading the saved chart of accounts…</div></div>';
        var disc = FL.fusion.disc ? Promise.resolve({ disc: FL.fusion.disc, where: 'this session' }) : FL.apexStore.loadDiscovery(s ? s.pod : '');
        return Promise.all([disc, D.segStatus()]).then(function (rr) {
            var r = rr[0];
            if (!r) { el.innerHTML = '<div class="card"><h3><i class="fa-solid fa-sitemap"></i> Chart of accounts</h3><p>Nothing discovered yet — run Discover in <a onclick="FL.dataTab.go(\'setup\')">Fusion setup</a> once; the result is kept in APEX and DuckDB.</p></div>'; return; }
            D.disc = r.disc;
            var d = r.disc, coas = Object.keys(d.coas || {});
            var ROLE = { company: ['COMPANY', 'Company · balancing'], costCentre: ['CC', 'Cost centre'], account: ['ACCOUNT', 'Natural account'], intercompany: ['IC', 'Intercompany'] };
            var chosen = (s && s.coa) || {};
            var h = '<div class="sm muted" style="margin-bottom:8px">Saved discovery (' + esc(r.where) + ') · ' + esc(String(r.at || d.discoveredAt || '').replace('T', ' ').slice(0, 16)) + (r.by ? ' by ' + esc(r.by) : '') + ' · ' + coas.length + ' chart(s) of accounts</div>';
            coas.forEach(function (id) {
                var c = d.coas[id], roles = chosen[id] || { company: c.company, costCentre: c.costCentre, account: c.account };
                var leds = (d.ledgers || []).filter(function (l) { return String(l.coaId) === id; });
                var nSync = c.segments.filter(function (sg) { return D.stat[id + '|' + sg.col]; }).length;
                h += '<div class="card" style="margin-bottom:12px"><div class="row"><h3 style="margin:0"><i class="fa-solid fa-sitemap"></i> Chart of accounts ' + esc(id) + '</h3><span class="sm muted">' + (c.combinations || 0).toLocaleString() + ' account combinations · ' + c.segments.length + ' segments</span><span class="grow"></span>' +
                    Object.keys(c.accountTypes || {}).map(function (t) { return '<span class="tag">' + esc({ A: 'Asset', L: 'Liability', O: 'Equity', R: 'Revenue', E: 'Expense' }[t] || t) + ' ' + c.accountTypes[t].toLocaleString() + '</span>'; }).join(' ') + '</div>' +
                    '<p class="sm">Ledgers: ' + leds.map(function (l) { return '<span class="tag">' + esc(l.name + ' · ' + l.currency) + '</span>'; }).join(' ') + '</p>' +
                    '<div class="row sm seg-sum" data-coa="' + esc(id) + '"><span class="segpill ' + (nSync === c.segments.length ? 'all' : nSync ? 'some' : 'none') + '"><i class="fa-solid ' + (nSync === c.segments.length ? 'fa-circle-check' : 'fa-circle-half-stroke') + '"></i> values synced for <b>' + nSync + ' of ' + c.segments.length + '</b> segments</span>' +
                    '<span class="muted"><i class="fa-solid fa-circle-check" style="color:#16a34a"></i> on this PC · <i class="fa-regular fa-circle-check" style="color:#0891b2"></i> in APEX only · <i class="fa-regular fa-circle" style="color:#94a3b8"></i> not read yet</span><span class="grow"></span>' +
                    (FL.who && FL.who.admin && nSync < c.segments.length ? '<button class="btn sm" data-readmiss="' + esc(id) + '"><i class="fa-solid fa-cloud-arrow-down"></i> Read the ' + (c.segments.length - nSync) + ' missing from Fusion</button>' : '') + '</div>' +
                    '<div class="segflow">' + c.segments.map(function (sg) {
                        var role = Object.keys(ROLE).filter(function (k) { return roles[k] === sg.col || (k === 'intercompany' && c.intercompany === sg.col); })[0];
                        return '<div class="segbox' + (role ? ' r-' + ROLE[role][0].toLowerCase() : '') + (D.seg && D.seg.coa === id && D.seg.col === sg.col ? ' on' : '') + (D.stat[id + '|' + sg.col] ? ' synced' : '') + '" data-coa="' + esc(id) + '" data-col="' + esc(sg.col) + '" data-vs="' + esc(sg.valueSetId || '') + '" data-distinct="' + (sg.distinct || 0) + '">' +
                            '<div class="sn">' + esc(sg.name) + '</div><div class="sc">' + esc(sg.col) + '</div>' + (role ? '<div class="sr">' + ROLE[role][1] + '</div>' : '<div class="sr muted">—</div>') +
                            '<div class="segst">' + D.segTick(id, sg) + '</div>' +
                            ((sg.qualifiers || []).length ? '<div class="sq">' + sg.qualifiers.map(esc).join(' ') + '</div>' : '') + '</div>';
                    }).join('<i class="fa-solid fa-minus sep"></i>') + '</div>' +
                    '<p class="sm muted">' + Object.keys(c.why || {}).map(function (k) { return '<b>' + esc((ROLE[k] || [k, k])[1]) + ':</b> ' + esc(c.why[k]); }).join(' · ') + '</p>' +
                    (D.seg && D.seg.coa === id ? '<div id="sv-box"></div>' : '<p class="sm">Click a segment to see its values.</p>') + '</div>';
            });
            el.innerHTML = h;
            el.querySelectorAll('[data-readmiss]').forEach(function (b) { b.onclick = function () { D.readMissing(el, b.dataset.readmiss); }; });
            el.querySelectorAll('.segbox').forEach(function (b) {
                b.onclick = function () { D.seg = { coa: b.dataset.coa, col: b.dataset.col, name: b.querySelector('.sn').textContent }; D.segVals = null; D.coa(el); };
            });
            if (D.seg && $('sv-box')) D.values($('sv-box'));
        });
    };
    /** Values of the chosen segment: DuckDB first, then APEX; "Read from Fusion" refreshes both */
    D.values = function (box) {
        var sg = D.seg, s = sv();
        var isAcct = s && (s.ledgers || []).some(function (l) { return String(l.coaId) === sg.coa && l.account === sg.col; });
        box.innerHTML = '<div class="row" style="margin:8px 0"><h4 style="margin:0">' + esc(sg.name + ' (' + sg.col + ')') + ' values</h4><span class="sm muted" id="sv-src"></span><span class="grow"></span>' +
            '<input id="sv-q" placeholder="Search value or description" style="min-width:200px">' +
            '<button class="btn sm" id="sv-csv"><i class="fa-solid fa-file-csv"></i> CSV</button>' +
            (FL.who && FL.who.admin ? '<button class="btn sm primary" id="sv-read"><i class="fa-solid fa-cloud-arrow-down"></i> Read from Fusion</button>' : '') + '</div><div id="fu-prog"></div><div id="sv-list"><div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i></div></div>';
        var show = function () {
            var vals = D.segVals || [], q = ($('sv-q').value || '').toLowerCase(), cls = {};
            if (isAcct) FL.dims.accounts.forEach(function (a) { cls[a.code] = a.class; });
            var list = vals.filter(function (v) { return !q || (v.value + ' ' + (v.description || '')).toLowerCase().indexOf(q) >= 0; });
            var used = vals.filter(function (v) { return v.combinations > 0; }).length;
            $('sv-list').innerHTML = '<p class="sm muted">' + vals.length.toLocaleString() + ' values · ' + used.toLocaleString() + ' used in account combinations' + (list.length > 1000 ? ' · first 1,000 of ' + list.length.toLocaleString() + ' shown' : '') + '</p>' +
                '<div class="scroll" style="max-height:420px">' + FL.table([{ label: 'Value', key: 'value' }, { label: 'Description', key: 'description' }, { label: 'Combinations', n: 1, get: function (v) { return v.combinations ? (+v.combinations).toLocaleString() : '—'; } },
                    { label: 'Account type', get: function (v) { return v.accountType || ''; } }].concat(isAcct ? [{ label: 'Class (mapping)', get: function (v) { return cls[v.value] || ''; } }] : []), list.slice(0, 1000)) + '</div>';
        };
        var load = function () {
            return FL.call('finSegValues', { coaId: sg.coa, column: sg.col }).then(function (r) {
                if (r.values && r.values.length) { D.segVals = r.values; $('sv-src').textContent = (r.source === 'pending' ? '· kept on this PC (DuckDB gets them with the first load), read ' : '· from DuckDB, read ') + String(r.values[0].fetchedAt || '').slice(0, 16); return; }
                return FL.apexStore.loadSegValues(s ? s.pod : '', sg.coa, sg.col).then(function (v) { D.segVals = v; $('sv-src').textContent = v.length ? '· from APEX, read ' + (v[0].fetchedAt || '') : '· not read yet — press Read from Fusion'; });
            }).catch(function (e) { $('sv-src').textContent = '· ' + e; D.segVals = []; });
        };
        $('sv-q').oninput = function () { clearTimeout(D.svt); D.svt = setTimeout(show, 200); };
        $('sv-csv').onclick = function () { FL.csv(sg.col + '-values.csv', ['value', 'description', 'combinations', 'account_type'], (D.segVals || []).map(function (v) { return [v.value, v.description, v.combinations, v.accountType]; })); };
        if ($('sv-read')) $('sv-read').onclick = function () {
            var p = FL.fusion.progress('Reading ' + sg.col + ' values from Fusion…', true);
            FL.call('finFusionSegValues', { pod: s ? s.pod : '', coaId: sg.coa, column: sg.col }, 20 * 60000, p).then(function (r) {
                D.segVals = r.values.map(function (v) { return { value: v.value, description: v.description, combinations: v.combinations, accountType: v.accountType }; });
                $('sv-src').textContent = '· from Fusion just now' + (r.savedDuck ? ' · saved in DuckDB' : r.pendingDuck ? ' · kept on this PC — DuckDB gets them with the first load' : ' · not saved in DuckDB');
                show();
                p('Saving ' + D.segVals.length.toLocaleString() + ' values in APEX…');
                return FL.apexStore.saveSegValues(s ? s.pod : '', sg.coa, sg.col, D.segVals, function (i, n) { p('APEX ' + i + ' / ' + n); }).then(function () {
                    $('sv-src').textContent += ' · saved in APEX'; FL.fusion.finish();
                    return D.segStatus().then(D.repaintTicks);
                });
            }).catch(function (e) { FL.fusion.finish(e && e.message || e); });
        };
        return (D.segVals ? Promise.resolve() : load()).then(show);
    };

    /** Which segments already have their values: this PC (DuckDB / pending file) and APEX → D.stat['coa|col'] = {pc, apex} */
    D.segStatus = function () {
        var s = sv();
        return Promise.all([
            FL.call('finSegValuesStatus').then(function (r) { return r.segments || []; }).catch(function () { return []; }),
            FL.apexStore.segValuesStatus(s ? s.pod : '').catch(function () { return []; })
        ]).then(function (r) {
            var m = {};
            r[0].forEach(function (x) { if (x.values > 0) (m[x.coaId + '|' + x.column] = m[x.coaId + '|' + x.column] || {}).pc = x; });
            r[1].forEach(function (x) { if (x.values > 0) (m[x.coaId + '|' + x.column] = m[x.coaId + '|' + x.column] || {}).apex = x; });
            D.stat = m; return m;
        });
    };
    /** The tick + counts on a segment card */
    D.segTick = function (coa, sg) {
        var st = (D.stat || {})[coa + '|' + sg.col], x = st && (st.pc || st.apex);
        if (!x) return '<i class="fa-regular fa-circle sok none" title="Values not read yet"></i><div class="sv">' + (sg.distinct ? sg.distinct.toLocaleString() + ' values in Fusion · ' : '') + 'not read yet</div>';
        var tip = (st.pc ? 'On this PC (' + (st.pc.source === 'pending' ? 'kept until the first load' : 'DuckDB') + '), read ' + String(st.pc.fetchedAt || '').slice(0, 16) : 'Not on this PC') + (st.apex ? ' · in APEX, read ' + st.apex.fetchedAt : ' · not in APEX');
        return '<i class="' + (st.pc ? 'fa-solid' : 'fa-regular') + ' fa-circle-check sok ' + (st.pc ? 'pc' : 'apex') + '" title="' + esc(tip) + '"></i>' +
            '<div class="sv" title="' + esc(tip) + '"><b>' + x.values.toLocaleString() + '</b> values · ' + x.used.toLocaleString() + ' used' + (x.named ? ' · ' + Math.round(x.named / x.values * 100) + '% named' : '') + '</div>' +
            '<div class="sv sm">' + (st.pc ? 'synced ' : 'APEX ') + esc(String(x.fetchedAt || '').slice(0, 10)) + '</div>';
    };
    D.repaintTicks = function () {
        document.querySelectorAll('.segbox[data-coa]').forEach(function (b) {
            var st = b.querySelector('.segst'); if (st) st.innerHTML = D.segTick(b.dataset.coa, { col: b.dataset.col, distinct: +b.dataset.distinct || 0 });
            b.classList.toggle('synced', !!(D.stat || {})[b.dataset.coa + '|' + b.dataset.col]);
        });
    };
    /** Reads, one after the other, the values of every segment of a chart that has none yet (this PC and APEX) */
    D.readMissing = function (el, coa) {
        var s = sv(), c = (D.disc.coas || {})[coa]; if (!c) return;
        var todo = c.segments.filter(function (sg) { return !D.stat[coa + '|' + sg.col]; });
        if (!todo.length) return;
        if (!$('fu-prog')) { var dv = document.createElement('div'); dv.id = 'fu-prog'; el.querySelector('.seg-sum[data-coa="' + coa + '"]').after(dv); }
        var p = FL.fusion.progress('Reading the values of ' + todo.length + ' segment(s) from Fusion…', true), done = 0, failed = [];
        var chain = Promise.resolve();
        todo.forEach(function (sg) {
            chain = chain.then(function () {
                p('▶ ' + sg.name + ' (' + sg.col + ') — ' + (done + 1) + ' of ' + todo.length);
                var b = el.querySelector('.segbox[data-coa="' + coa + '"][data-col="' + sg.col + '"] .segst'); if (b) b.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin sok"></i><div class="sv">reading…</div>';
                return FL.call('finFusionSegValues', { pod: s ? s.pod : '', coaId: coa, column: sg.col }, 20 * 60000, p).then(function (r) {
                    var vals = r.values.map(function (v) { return { value: v.value, description: v.description, combinations: v.combinations, accountType: v.accountType }; });
                    p('✔ ' + sg.col + ': ' + vals.length.toLocaleString() + ' values — saving in APEX');
                    return FL.apexStore.saveSegValues(s ? s.pod : '', coa, sg.col, vals);
                }).catch(function (e) { failed.push(sg.col + ': ' + (e && e.message || e)); p('⚠ ' + sg.col + ': ' + (e && e.message || e)); })
                    .then(function () { done++; return D.segStatus().then(D.repaintTicks); });
            });
        });
        chain.then(function () { FL.fusion.finish(failed.length ? failed.join(' · ') : null); FL.toast(failed.length ? failed.length + ' segment(s) failed' : 'Values read for ' + done + ' segment(s)', failed.length ? 'err' : 'ok'); D.coa(el); });
    };

    // ═════════ Fusion setup (SQL) ═════════
    D.setup = function (el) { el.innerHTML = '<div class="card" id="fus-card"></div>'; FL.fusion.render($('fus-card')); };

    // ═════════ BICC ═════════
    D.bicc = function (el) {
        var s = sv(), cfg = FL.config.bicc = FL.config.bicc || {}, admin = FL.who && FL.who.admin;
        var folder = cfg.folder || '';
        el.innerHTML = '<div class="card"><h3><i class="fa-solid fa-boxes-stacked"></i> BICC bulk extracts <small>every GL balance and journal line in one pass — no month-by-month SQL</small></h3>' +
            '<p class="sm">Oracle BI Cloud Connector extracts the GL view objects to files (UCM or OCI Object Storage). Finance Lens reads those files with DuckDB — millions of rows in seconds — keeps the newest version of every row (full + incremental extracts can sit side by side) and builds the same tables as the SQL load. Ledgers, segments and the calendar come from your <a onclick="FL.dataTab.go(\'setup\')">Fusion setup</a>.</p>' +
            '<details class="sm"><summary>How to set up the extract in BICC (once)</summary><ol>' +
            '<li>BI Cloud Connector Console › Configure Cloud Extract: offering <b>Financial</b>, data stores <code>FscmTopModelAM.FinExtractAM.GlBiccExtractAM</code> › <b>BalanceExtractPVO</b>, <b>CodeCombinationExtractPVO</b>, <b>JournalHeaderExtractPVO</b>, <b>JournalLineExtractPVO</b>, <b>JournalBatchExtractPVO</b>.</li>' +
            '<li>Configure External Storage: <b>UCM</b> (default) — or OCI Object Storage synced to the folder below.</li>' +
            '<li>Manage Extract Schedules: a full extract once, then a daily incremental. The files are named <code>file_fscmtopmodelam_finextractam_glbiccextractam_balanceextractpvo-batch…-YYYYMMDD_HHMMSS.zip</code>.</li>' +
            '<li>The Fusion user of this app needs a role that can read the BICC account in UCM (e.g. <i>ORA_ASM_APPLICATION_IMPLEMENTATION_ADMIN_ABSTRACT</i> / BIA_ADMINISTRATOR_DUTY) for the download below.</li></ol></details>' +
            '<div class="row" style="margin-top:10px"><label class="sm" style="flex:1">Folder <input id="bc-folder" value="' + esc(folder) + '" placeholder="default: the bicc folder next to the finance data" style="width:100%"></label><button class="btn" id="bc-inspect"><i class="fa-solid fa-magnifying-glass"></i> Look at the files</button></div>' +
            '<div id="bc-files"></div></div><div id="fu-prog"></div>' +
            (admin ? '<div class="card" style="margin-top:12px"><h3><i class="fa-solid fa-cloud-arrow-down"></i> Download from UCM</h3><div class="row"><label class="sm">Pod <select id="bc-pod"><option value="">Logged-in pod</option><option' + ((s && s.pod) === 'PROD' ? ' selected' : '') + '>PROD</option><option' + ((s && s.pod) === 'TEST' ? ' selected' : '') + '>TEST</option></select></label>' +
                '<button class="btn" id="bc-list"><i class="fa-solid fa-list"></i> List BICC files in UCM</button><button class="btn primary" id="bc-dl" disabled><i class="fa-solid fa-download"></i> Download selected</button></div><div id="bc-ucm"></div></div>' +
                '<div class="card" style="margin-top:12px"><h3><i class="fa-solid fa-database"></i> Load into Finance Lens</h3>' +
                (s && s.ledgers ? '<p class="sm">Ledgers ' + s.ledgers.map(function (l) { return '<b>' + esc(l.name) + '</b> (' + esc(l.company + ' / ' + (l.costCentre || '—') + ' / ' + l.account) + ')'; }).join(', ') + '</p>' +
                    '<div class="row"><label class="sm">From <select id="bc-from">' + (s.calendar || []).map(function (p) { return '<option value="' + p.seq + '"' + (p.seq === s.fromSeq ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select></label>' +
                    '<label class="sm">To <select id="bc-to">' + (s.calendar || []).map(function (p) { return '<option value="' + p.seq + '"' + (p.seq === (FL.fusion.latestSeq(s) || s.toSeq) ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select></label>' +
                    '<label class="sm"><input type="checkbox" id="bc-jnl" checked> journal lines</label>' +
                    '<label class="sm">Budget version id <input id="bc-bud" value="' + esc(s.budgetSource === 'GL_BALANCES' ? s.budgetId || '' : '') + '" style="width:90px"></label>' +
                    '<button class="btn primary" id="bc-load"><i class="fa-solid fa-database"></i> Load from the BICC files</button></div>'
                    : '<p>Set up the ledgers and segments in <a onclick="FL.dataTab.go(\'setup\')">Fusion setup</a> first (Discover, choose ledgers and segments).</p>') + '</div>' : '');
        $('bc-inspect').onclick = function () { D.biccInspect(); };
        if ($('bc-list')) $('bc-list').onclick = function () { D.ucmList(); };
        if ($('bc-dl')) $('bc-dl').onclick = function () { D.ucmDownload(); };
        if ($('bc-load')) $('bc-load').onclick = function () { D.biccLoad(); };
        if (D.biccRes) D.biccShow(); else D.biccInspect();
        if (D.ucm) D.ucmShow();
    };
    D.biccFolder = function () { var f = $('bc-folder') ? $('bc-folder').value.trim() : ''; if (f !== (FL.config.bicc.folder || '')) { FL.config.bicc.folder = f; FL.saveConfig(); } return f; };
    D.biccInspect = function () {
        $('bc-files').innerHTML = '<p class="sm muted"><i class="fa-solid fa-circle-notch fa-spin"></i> Reading the folder…</p>';
        return FL.call('finBiccInspect', { folder: D.biccFolder(), map: FL.config.bicc.map || {} }).then(function (r) { D.biccRes = r; D.biccShow(); })
            .catch(function (e) { $('bc-files').innerHTML = '<div class="callout bad">' + esc(e) + '</div>'; });
    };
    D.biccShow = function () {
        var r = D.biccRes, box = $('bc-files'); if (!box || !r) return;
        box.innerHTML = '<p class="sm muted">' + esc(r.folder) + '</p><div class="grid g2" style="gap:8px">' + r.pvos.map(function (p) {
            var newest = p.files[0];
            return '<div class="card" style="padding:10px"><div class="row"><b>' + esc(p.key.replace('_', ' ')) + '</b><span class="grow"></span>' +
                (p.fileCount ? '<span class="tag good">' + p.fileCount + ' file(s) · ' + (p.bytes / 1048576).toFixed(1) + ' MB</span>' : '<span class="tag' + (p.key === 'balances' || p.key === 'combinations' ? ' bad' : '') + '">no files</span>') + '</div>' +
                '<div class="sm muted mono" style="word-break:break-all">' + esc(p.pvo) + '</div>' + (newest ? '<div class="sm">newest: ' + esc(newest.name) + ' · ' + esc(newest.date.replace('T', ' ')) + '</div>' : '') +
                (p.error ? '<div class="callout bad sm">' + esc(p.error) + '</div>' : '') +
                (p.fileCount && p.missing && p.missing.length ? '<div class="callout warn sm">No column found for <b>' + p.missing.map(esc).join(', ') + '</b> — pick it: ' + p.missing.map(function (a) {
                    return '<label>' + esc(a) + ' <select class="bc-map" data-k="' + esc(p.key + '.' + a) + '"><option value="">—</option>' + p.columns.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('') + '</select></label>';
                }).join(' ') + '</div>' : '') +
                (p.fileCount ? '<details class="sm"><summary>' + Object.keys(p.map).length + ' columns matched</summary>' + Object.keys(p.map).map(function (a) { return esc(a) + ' ← <span class="mono">' + esc(p.map[a]) + '</span>'; }).join('<br>') + '</details>' : '') + '</div>';
        }).join('') + '</div>';
        box.querySelectorAll('.bc-map').forEach(function (sel) {
            sel.onchange = function () { FL.config.bicc.map = FL.config.bicc.map || {}; if (sel.value) FL.config.bicc.map[sel.dataset.k] = sel.value; else delete FL.config.bicc.map[sel.dataset.k]; FL.saveConfig().then(D.biccInspect); };
        });
    };
    D.ucmList = function () {
        $('bc-ucm').innerHTML = '<p class="sm muted"><i class="fa-solid fa-circle-notch fa-spin"></i> Asking UCM…</p>';
        FL.call('finUcmList', { pod: $('bc-pod').value }, 300000).then(function (r) { D.ucm = r.files; D.ucmShow(); })
            .catch(function (e) { $('bc-ucm').innerHTML = '<div class="callout bad">' + esc(e) + '</div>'; });
    };
    D.ucmShow = function () {
        var files = D.ucm || [], have = {}, box = $('bc-ucm'); if (!box) return;
        (D.biccRes ? D.biccRes.pvos : []).forEach(function (p) { p.files.forEach(function (f) { have[String(f.name).toLowerCase().replace(/\.(zip|csv)$/, '')] = 1; }); });
        var isNew = function (f) { return !have[String(f.title || '').toLowerCase().replace(/\.(zip|csv)$/, '')]; };
        box.innerHTML = files.length ? '<p class="sm muted">' + files.length + ' file(s) in UCM · ticked: the ones not in the folder yet</p><div class="scroll" style="max-height:300px"><table class="t"><thead><tr><th><input type="checkbox" id="uc-all"></th><th>PVO</th><th>File</th><th>Date</th><th class="n">Size</th></tr></thead><tbody>' +
            files.map(function (f, i) { return '<tr><td><input type="checkbox" class="uc-f" data-i="' + i + '"' + (isNew(f) ? ' checked' : '') + '></td><td>' + esc(f.pvo) + '</td><td class="mono sm">' + esc(f.title) + '</td><td>' + esc(f.date || '') + '</td><td class="n">' + esc(f.size || '') + '</td></tr>'; }).join('') +
            '</tbody></table></div>' : '<p class="sm">No BICC GL files found in UCM.</p>';
        if ($('bc-dl')) $('bc-dl').disabled = !files.length;
        if ($('uc-all')) $('uc-all').onchange = function () { var on = this.checked; box.querySelectorAll('.uc-f').forEach(function (c) { c.checked = on; }); };
    };
    D.ucmDownload = function () {
        var pick = Array.prototype.filter.call(document.querySelectorAll('.uc-f'), function (c) { return c.checked; }).map(function (c) { var f = D.ucm[+c.dataset.i]; return { id: String(f.id), title: f.title }; });
        if (!pick.length) { FL.toast('Tick the files to download', 'err'); return; }
        var p = FL.fusion.progress('Downloading ' + pick.length + ' file(s) from UCM…', true);
        FL.call('finUcmDownload', { pod: $('bc-pod').value, docs: pick, folder: D.biccFolder() }, 2 * 3600000, p).then(function (r) {
            FL.toast(r.saved.length + ' file(s) in ' + r.folder, 'ok'); FL.fusion.finish(); D.biccInspect().then(D.ucmShow);
        }).catch(function (e) { FL.fusion.finish(e); });
    };
    D.biccLoad = function () {
        var s = sv();
        FL.apexStore.loadDiscovery(s.pod).then(function (r) {
            var d = (r && r.disc) || FL.fusion.disc, first = s.ledgers[0];
            var cal = d && d.calendars ? d.calendars[first.periodSet + '|' + first.periodType] : null;
            if (!cal) { FL.toast('The calendar is missing — run Discover once in Fusion setup', 'err'); return; }
            if (!confirm('Load every GL balance' + ($('bc-jnl').checked ? ' and journal line' : '') + ' from the BICC files into Finance Lens? This replaces the finance data on this PC.')) return;
            var p = FL.fusion.progress('Loading the BICC extracts…', true);
            FL.call('finBiccLoad', { options: { folder: D.biccFolder(), ledgers: s.ledgers, calendar: cal.map(function (c) { return { name: c.name, year: c.year, num: c.num, quarter: c.quarter, start: c.start, end: c.end, adj: c.adj }; }),
                fromSeq: +$('bc-from').value, toSeq: +$('bc-to').value, journals: $('bc-jnl').checked, budgetVersionId: $('bc-bud').value.trim(), foldAdjustments: s.foldAdjustments !== false, map: FL.config.bicc.map || {}, pod: s.pod || '' } }, 4 * 3600000, p)
                .then(function (res) {
                    FL.fusion.keepLog(); FL.fusion.finish();
                    FL.toast('BICC: ' + res.balances.toLocaleString() + ' balances, ' + res.journals.toLocaleString() + ' journal lines in ' + Math.round(res.ms / 1000) + ' s', 'ok');
                    FL.config.fusion.loader = 'BICC'; FL.config.fusion.lastSync = new Date().toISOString();
                    return FL.saveConfig().then(FL.refresh);
                }).catch(function (e) { FL.fusion.keepLog(); FL.fusion.finish(e); });
        });
    };

    // ═════════ Account mapping ═════════
    D.mapping = function (el) {
        if (!(FL.status || {}).loaded) { el.innerHTML = '<div class="card">Load data first.</div>'; return; }
        el.innerHTML = '<div class="card" id="map-card"></div>'; FL.mapping.render($('map-card'));
    };

    // ═════════ SQL explorer ═════════
    D.sql = function (el) {
        // the trial balance sync status (year tiles, Sync) on top — the SQL explorer below
        el.innerHTML = '<div id="d-tbs"></div><div id="d-sqlx" style="margin-top:12px"></div>';
        FL.tbsync.mini($('d-tbs'));
        D.sqlx($('d-sqlx'));
    };
    D.sqlx = function (el) {
        if (!(FL.status || {}).loaded) { el.innerHTML = '<div class="card sm muted">The SQL explorer reads the finance data — sync a trial balance above or load from Fusion first.</div>'; return; }
        var per = FL.filter.period;
        var samples = [['Trial balance', "SELECT b.account, a.name, a.account_type, ROUND(SUM(b.end_bal), 2) AS balance FROM fin_balances b JOIN fin_accounts a ON a.code = b.account WHERE b.scenario = 'ACTUAL' AND b.period_seq = " + per + ' GROUP BY ALL ORDER BY 1'],
            ['TB sync status', "SELECT l.name AS ledger, s.period_name, p.period_seq, s.grain, s.company, s.rows_read, CAST(s.fetched_at AS VARCHAR) AS read_at, s.ms FROM fin_gl_balances_acct_sync s LEFT JOIN fin_tb_ledgers l ON l.pod = s.pod AND l.ledger_id = s.ledger_id LEFT JOIN fin_tb_periods p ON p.pod = s.pod AND p.ledger_id = s.ledger_id AND p.period_name = s.period_name ORDER BY 1, 3 DESC, 2, 5"],
            ['Extended segments sync', "SELECT s.pod, s.ledger_id, s.period_name, s.company, s.segments, s.rows_read, CAST(s.fetched_at AS VARCHAR) AS read_at, s.ms FROM fin_gl_balances_ext_sync s ORDER BY 2, 3, 4"],
            ['Balances by extended segments', "SELECT period_seq, company, account, segment3, segment8, segment10, segment15, ROUND(SUM(dr), 2) AS dr, ROUND(SUM(cr), 2) AS cr, ROUND(SUM(dr - cr), 2) AS net FROM fin_gl_ext_v GROUP BY ALL ORDER BY 1 DESC, 2, 3 LIMIT 500"],
            ['TB by period', "SELECT b.ledger, b.period_name, COUNT(*) AS lines, ROUND(SUM(b.period_dr), 2) AS debits, ROUND(SUM(b.period_cr), 2) AS credits, ROUND(SUM(b.end_bal), 2) AS closing_net FROM fin_balances b WHERE b.scenario = 'ACTUAL' GROUP BY ALL ORDER BY 1, MIN(b.period_seq)"],
            ['Full load sync status', 'SELECT ledger, period_name, kind, rows_read, dr, cr, synced_at, ms, split FROM fin_sync_periods ORDER BY ledger, period_seq, kind'],
            ['COA segments', 'SELECT * FROM fin_coa_segments ORDER BY coa_id, segment_num'],
            ['Account mapping', 'SELECT a.code, a.name, a.account_type, a.class, m.source, m.changed_by FROM fin_accounts a LEFT JOIN fin_account_map m ON m.code = a.code ORDER BY 1'],
            ['Revenue by month', "SELECT b.period_name, b.period_seq, -SUM(b.period_net) AS revenue FROM fin_balances b JOIN fin_accounts a ON a.code = b.account WHERE b.scenario = 'ACTUAL' AND a.account_type = 'R' GROUP BY ALL ORDER BY 2"],
            ['Manual journals', "SELECT je_name, created_by, CAST(accounting_date AS VARCHAR) AS date, SUM(dr) AS amount FROM fin_journals WHERE je_source ILIKE '%manual%' GROUP BY ALL ORDER BY amount DESC LIMIT 100"]];
        el.innerHTML = '<div class="card"><h3><i class="fa-solid fa-terminal"></i> SQL explorer <small>read-only DuckDB SQL: fin_balances, fin_journals, fin_accounts, fin_periods, fin_companies, fin_cost_centres, fin_ledgers, fin_coa_segments, fin_segment_values, fin_sync_periods, fin_account_map</small></h3>' +
            '<div class="row" style="margin-bottom:6px">' + samples.map(function (x, i) { return '<button class="btn sm" data-q="' + i + '">' + esc(x[0]) + '</button>'; }).join('') + '</div>' +
            '<textarea class="sql" id="d-sql">' + esc(FL.ls('sql', samples[0][1])) + '</textarea>' +
            '<div class="row" style="margin:6px 0"><button class="btn primary sm" id="d-run"><i class="fa-solid fa-play"></i> Run (Ctrl+Enter)</button><button class="btn sm" id="d-csv"><i class="fa-solid fa-file-csv"></i> CSV</button><span class="sm muted" id="d-info"></span></div><div class="scroll" id="d-res"></div></div>';
        var last = null;
        var run = function () {
            var sql = $('d-sql').value; FL.lsSet('sql', sql); $('d-info').textContent = 'running…';
            FL.sql(sql, 5000).then(function (d) {
                last = d;
                $('d-info').textContent = d.rows.length.toLocaleString() + ' row(s)' + (d.truncated ? ' (first 5,000)' : '') + ' · ' + d.ms + ' ms';
                $('d-res').innerHTML = '<table class="t"><thead><tr>' + d.columns.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
                    d.rows.slice(0, 2000).map(function (r) { return '<tr>' + r.map(function (v) { return '<td class="' + (typeof v === 'number' ? 'n' : '') + '">' + esc(typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(2)) : v) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>';
            }).catch(function (e) { $('d-info').innerHTML = '<span class="neg">' + esc(e) + '</span>'; });
        };
        el.querySelectorAll('[data-q]').forEach(function (b) { b.onclick = function () { $('d-sql').value = samples[+b.dataset.q][1]; run(); }; });
        $('d-run').onclick = run;
        $('d-sql').onkeydown = function (e) { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); run(); } };
        $('d-csv').onclick = function () { if (last) FL.csv('query.csv', last.columns, last.rows); };
    };

    // ═════════ Data & folder ═════════
    D.settings = function (el) {
        var st = FL.status || {}, m = st.meta || {}, c = st.counts || {}, admin = FL.who && FL.who.admin;
        el.innerHTML = '<div class="card"><h3><i class="fa-solid fa-database"></i> Finance data on this PC</h3>' +
            (st.oldSample ? '<div class="callout warn sm">This PC still holds the old built-in sample data — it is not shown. <a onclick="FL.clearData()">Remove it</a></div>' : '') +
            (st.loaded ? '<table class="t"><tbody>' + [['Source', m.source + (m.loader ? ' · ' + m.loader : '')], ['Loaded', m.loaded_at], ['Description', m.description], ['Periods', (c.first_period || '') + ' – ' + (c.last_period || '')],
                ['Companies · cost centres · accounts', (c.companies || 0) + ' · ' + (c.cost_centres || 0) + ' · ' + (c.accounts || 0)], ['Balances', (c.balances || 0).toLocaleString()], ['Journal lines', (c.journals || 0).toLocaleString()],
                ['File', st.root + ' (' + st.sizeMb + ' MB)'], ['Also kept there', 'templates.json, config.json (setup, mapping), fusion-sync.log, bicc\\ (extract files)']]
                .map(function (r) { return '<tr><td class="muted">' + esc(r[0]) + '</td><td>' + esc(r[1] == null ? '' : r[1]) + '</td></tr>'; }).join('') + '</tbody></table>' : '<p>No data yet.</p>') +
            '<div class="row" style="margin-top:10px">' + (admin ? (st.loaded ? '<button class="btn" onclick="FL.clearData()"><i class="fa-solid fa-trash-can"></i> Remove the data on this PC</button>' : '') + '<button class="btn" id="d-root"><i class="fa-regular fa-folder"></i> Folder…</button>' : '<span class="sm muted">An AI admin loads data and sets the folder.</span>') +
            '<button class="btn" onclick="FL.refresh()"><i class="fa-solid fa-rotate"></i> Reload</button></div></div>' +
            (st.loaded ? '<div class="card" style="margin-top:12px"><h3><i class="fa-solid fa-sitemap"></i> Accounts <small>' + FL.dims.accounts.length + '</small></h3><div class="scroll" style="max-height:320px">' +
                FL.table([{ label: 'Account', key: 'code' }, { label: 'Name', key: 'name' }, { label: 'Type', key: 'account_type' }, { label: 'Class', key: 'class' }], FL.dims.accounts.slice(0, 2000)) + '</div></div>' : '');
        if ($('d-root')) $('d-root').onclick = function () {
            var r = prompt('Folder for the finance data (DuckDB file, templates.json, config.json):', st.root || 'C:\\fusion\\finance');
            if (r) FL.call('finSetRoot', { root: r }).then(function () { FL.toast('Folder set', 'ok'); FL.refresh(); }).catch(function (e) { FL.toast(String(e), 'err'); });
        };
    };
})();
