/* Finance Lens — Oracle Fusion: discover the ledgers and the chart of accounts (balancing / account / cost centre segment,
   account types) and sync the journal balances into DuckDB (host: classes/FinanceFusion.cs, finFusionDiscover /
   finFusionSync with finProgress, finCancel); the account mapping (class per account → statement lines, unmapped and
   double-counted accounts, quick re-assign); and the drill from a statement line to the accounts mapped to it. */
(function () {
    var F = FL.fusion = { busy: false };
    var ROLE = { company: 'Company (balancing)', costCentre: 'Cost centre', account: 'Natural account', intercompany: 'Intercompany' };
    var TYPE = { A: 'Asset', L: 'Liability', O: 'Equity', R: 'Revenue', E: 'Expense' };

    F.saved = function () { return (FL.config && FL.config.fusion) || null; };

    // ═════ the Fusion card in the Data tab ═════
    F.render = function (el) {
        F.el = el;
        var admin = FL.who && FL.who.admin, sv = F.saved(), m = (FL.status || {}).meta || {};
        var h = '<h3><i class="fa-solid fa-cloud-arrow-down"></i> Oracle Fusion general ledger</h3>';
        if (m.source === 'FUSION') h += '<div class="callout good sm"><i class="fa-solid fa-circle-check"></i> Loaded from Fusion ' + esc(m.pod || '') + ' · ' + esc(m.description || '') + ' · ' + esc(m.load_mode || '') + ' at ' + esc(m.loaded_at || '') + '</div>';
        if (!admin) { el.innerHTML = h + '<p class="sm">An AI admin connects Finance Lens to Fusion: it finds the ledgers, the balancing, account and cost centre segments and the account types, then loads the balances and journals into this PC\'s DuckDB file.</p>'; return; }
        if (sv && sv.ledgers && sv.ledgers.length && !F.editing) {
            h += '<table class="t"><tbody>' + [['Pod', sv.pod || 'logged-in pod'], ['Ledgers', sv.ledgers.map(function (l) { return l.name + ' (' + l.currency + ')'; }).join(', ')],
                ['Segments', sv.ledgers.map(function (l) { return 'company ' + l.company + ' · cost centre ' + (l.costCentre || '—') + ' · account ' + l.account; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(' / ')],
                ['Periods', F.pname(sv.fromSeq) + ' – ' + F.pname(sv.toSeq)], ['Budget', sv.budgetSource ? sv.budgetName || sv.budgetId : 'none'], ['Journal lines', sv.journalMonths ? 'last ' + sv.journalMonths + ' month(s)' : 'not loaded'],
                ['Reading', 'ranked chunks of ' + (sv.chunkSize || 2000).toLocaleString() + ' rows · ' + (sv.parallel || 2) + ' in parallel'],
                ['Chart of accounts stored in', 'APEX (WMS_FIN_COA_SEGMENTS, WMS_FIN_LEDGERS, WMS_FIN_DISCOVERY) and DuckDB (fin_coa_segments, fin_ledgers)' + (sv.discoveredAt ? ' · discovered ' + String(sv.discoveredAt).replace('T', ' ').slice(0, 16) : '')]]
                .map(function (r) { return '<tr><td class="muted">' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td></tr>'; }).join('') + '</tbody></table>' +
                '<div class="row" style="margin-top:10px"><button class="btn primary" id="fu-status"><i class="fa-solid fa-signal"></i> Load / sync in Sync status</button>' +
                '<span class="grow"></span><button class="btn" id="fu-setup"><i class="fa-solid fa-sliders"></i> Change setup</button></div>' + F.lastLogLink() + '<div id="fu-prog"></div>';
            el.innerHTML = h;
            F.wireLastLog();
            $('fu-setup').onclick = function () { F.editing = true; F.render(el); };
            $('fu-status').onclick = function () { FL.dataTab.go('status'); };
            F.paint();
            return;
        }
        h += '<p class="sm">Finance Lens reads Fusion through the read-only Fusion SQL runner: the ledgers (<code>GL_LEDGERS</code>), the chart of accounts segments and their qualifiers, the account type of every account (<code>GL_CODE_COMBINATIONS</code>), the calendar and the budgets — then loads <code>GL_BALANCES</code> summed to company × cost centre × account and the posted journal lines.</p>' +
            '<div class="row"><label class="sm">Pod <select id="fu-pod"><option value="">Logged-in pod</option><option value="PROD"' + ((sv || {}).pod === 'PROD' ? ' selected' : '') + '>PROD</option><option value="TEST"' + ((sv || {}).pod === 'TEST' ? ' selected' : '') + '>TEST</option></select></label>' +
            '<button class="btn primary" id="fu-disc"><i class="fa-solid fa-magnifying-glass-chart"></i> Discover ledgers &amp; chart of accounts</button>' +
            (sv ? '<button class="btn ghost" id="fu-back">Back</button>' : '') + '</div><div id="fu-prog"></div><div id="fu-res"></div>';
        el.innerHTML = h;
        if ($('fu-back')) $('fu-back').onclick = function () { F.editing = false; F.render(el); };
        $('fu-disc').onclick = function () { F.discover($('fu-pod').value); };
        $('fu-pod').onchange = function () { F.disc = null; F.restore(this.value); };
        if (F.disc) F.showDiscovery(); else F.restore($('fu-pod').value);
        F.paint();
    };

    /** Shows the chart of accounts saved for this pod (APEX, else this PC's DuckDB file) — no need to ask Fusion again. */
    F.restore = function (pod) {
        var box = $('fu-res'); if (!box) return;
        box.innerHTML = '<p class="sm muted"><i class="fa-solid fa-circle-notch fa-spin"></i> Looking for the saved chart of accounts…</p>';
        FL.apexStore.loadDiscovery(pod).then(function (r) {
            if (!$('fu-res') || ($('fu-pod') && $('fu-pod').value !== (pod || ''))) return;
            if (!r) { $('fu-res').innerHTML = '<p class="sm muted">Nothing saved for this pod yet — press Discover once; the result is kept in APEX and DuckDB.</p>'; return; }
            F.disc = r.disc; F.discFrom = r;
            F.showDiscovery();
        });
    };

    F.pname = function (seq) {
        var sv = F.saved(), c = (sv && sv.calendar) || (F.cal || []);
        var p = c.filter(function (x) { return x.seq === +seq; })[0];
        return p ? p.name : FL.periodName(seq);
    };
    /** The newest period that has started (today), for "sync again" */
    F.latestSeq = function (sv) {
        var today = new Date().toISOString().slice(0, 10), c = (sv.calendar || []).filter(function (p) { return !p.start || p.start <= today; });
        return c.length ? c[c.length - 1].seq : null;
    };

    // ═════ live monitor: what runs in Fusion right now (SQL, how long), first rows of every step, the log ═════
    // The host sends text lines (the log) and structured events ("\u0001" + JSON: sql / end / sample — FinanceFusion.Ctx.Live).
    // The run lives in F.run, so leaving the view and coming back (Data › Sync status) shows it again while it goes on.
    F.log = [];
    F.run = null;
    F.progress = function (title, cancel) {
        F.log = [];
        var R = F.run = { title: title, cancel: !!cancel, running: true, t0: Date.now(), sql: {}, done: [], samples: [], chunks: 0, rows: 0, pct: 0, tab: FL.ls('mon.tab', 'running'), error: null, end: null };
        F.paint(true);
        clearInterval(F.tick);
        F.tick = setInterval(function () { if (!R.running) { clearInterval(F.tick); return; } F.paintTimes(); }, 1000);
        return function (msg) {
            msg = String(msg || '');
            if (msg.charAt(0) === '\u0001') { try { F.live(R, JSON.parse(msg.slice(1))); } catch (e) { /* not an event */ } return; }
            var stamp = new Date().toTimeString().slice(0, 8);
            F.log.push(stamp + '  ' + msg);
            if (F.log.length > 20000) F.log.shift();
            var m = /^\[(\d+)\/(\d+)\]/.exec(msg);
            if (m) R.pct = Math.round(+m[1] / +m[2] * 100);
            var ch = /· chunk \d+ · rows ([\d,]+)–([\d,]+)/.exec(msg);
            if (ch) { R.chunks++; R.rows += (+ch[2].replace(/,/g, '')) - (+ch[1].replace(/,/g, '')) + 1; }
            if (R !== F.run) return;
            if ($('fu-barv')) $('fu-barv').style.width = R.pct + '%';
            F.paintTimes();
            var log = $('fu-log'); if (!log) return;
            var cls = /✖|failed/.test(msg) ? 'neg' : /⚠/.test(msg) ? 'warn' : /✓|^Done/.test(msg) ? 'pos' : /^\s*SQL:/.test(msg) ? 'sql' : ch ? 'chunk' : /^▶/.test(msg.trim()) ? 'step' : '';
            var stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
            log.insertAdjacentHTML('beforeend', '<div class="' + cls + '"><span class="ts">' + stamp + '</span>' + esc(msg) + '</div>');
            while (log.childNodes.length > 5000) log.removeChild(log.firstChild);
            if (stick) log.scrollTop = log.scrollHeight;
        };
    };
    F.live = function (R, e) {
        if (e.t === 'sql') R.sql[e.id] = { id: e.id, what: e.what, sql: e.sql, at: e.at, t: Date.now() };
        else if (e.t === 'end') {
            var q = R.sql[e.id]; delete R.sql[e.id];
            if (q) { q.ms = e.ms; q.rows = e.rows; q.ok = e.ok; q.error = e.error; q.skipped = !!e.skipped; R.done.unshift(q); if (R.done.length > 60) R.done.pop(); }
        } else if (e.t === 'sample') { R.samples.unshift({ what: e.what, cols: e.cols, rows: e.rows, at: new Date().toTimeString().slice(0, 8) }); if (R.samples.length > 30) R.samples.pop(); }
        if (R !== F.run) return;
        if (e.t === 'sample' && R.tab !== 'sample') { if ($('mon-ns')) $('mon-ns').textContent = R.samples.length; return; }
        clearTimeout(F.paintT); F.paintT = setTimeout(function () { F.paintPane(); }, 120);
    };
    /** Marks the current run finished (ok / error text); the monitor stays readable. */
    F.finish = function (err) {
        var R = F.run; if (!R) return;
        R.running = false; R.error = err ? String(err) : null; R.end = Date.now(); R.sql = {};
        clearInterval(F.tick);
        if ($('fu-pt')) $('fu-pt').innerHTML = err ? '<i class="fa-solid fa-circle-xmark neg"></i> ' + esc(R.title.replace(/…$/, '')) + ' — stopped' : '<i class="fa-solid fa-circle-check pos"></i> ' + esc(R.title.replace(/…$/, '')) + ' — done';
        F.paint();
    };
    F.secs = function (ms) { var s = Math.round(ms / 1000); return s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + (s % 60) + ' s'; };
    /** Draws the monitor into #fu-prog of the current view (fresh = a new run). */
    F.paint = function () {
        var box = $('fu-prog'), R = F.run; if (!box || !R) return;
        var tabs = [['running', 'fa-bolt', 'Running now'], ['done', 'fa-list-check', 'Finished queries'], ['sample', 'fa-table', 'Sample rows'], ['log', 'fa-scroll', 'Log']];
        box.innerHTML = '<div class="fu-prog mon"><div class="row"><b id="fu-pt">' + (R.running ? '<i class="fa-solid fa-circle-notch fa-spin"></i> ' + esc(R.title) : (R.error ? '<i class="fa-solid fa-circle-xmark neg"></i> ' : '<i class="fa-solid fa-circle-check pos"></i> ') + esc(R.title.replace(/…$/, '')) + (R.error ? ' — stopped' : ' — done')) + '</b>' +
            '<span class="sm muted" id="fu-pstat"></span><span class="grow"></span>' +
            '<button class="btn sm" id="fu-logcopy" title="Copy the log"><i class="fa-regular fa-copy"></i></button><button class="btn sm" id="fu-logsave" title="Save the log as a text file"><i class="fa-solid fa-download"></i> Log</button>' +
            (R.cancel && R.running ? '<button class="btn sm" id="fu-cancel"><i class="fa-solid fa-stop"></i> Cancel</button>' : '') +
            (!R.running ? '<button class="btn sm ghost" id="fu-close" title="Hide this monitor"><i class="fa-solid fa-xmark"></i></button>' : '') + '</div><div class="fu-bar"><i id="fu-barv" style="width:' + R.pct + '%"></i></div>' +
            '<div class="seg mon-tabs">' + tabs.map(function (t) { return '<button data-t="' + t[0] + '" class="' + (R.tab === t[0] ? 'on' : '') + '"><i class="fa-solid ' + t[1] + '"></i> ' + t[2] + (t[0] === 'sample' ? ' <span class="tag" id="mon-ns">' + R.samples.length + '</span>' : t[0] === 'running' ? ' <span class="tag" id="mon-nr">' + Object.keys(R.sql).length + '</span>' : '') + '</button>'; }).join('') +
            '<label class="sm" style="margin-left:auto"><input type="checkbox" id="fu-chunks"' + (F.hideChunks ? '' : ' checked') + '> chunk lines</label></div>' +
            '<div id="mon-pane"></div><div class="fu-log' + (F.hideChunks ? ' nochunks' : '') + '" id="fu-log"' + (R.tab === 'log' ? '' : ' style="display:none"') + '></div>' +
            (R.error ? '<div class="callout bad">' + esc(R.error) + '</div>' : '') + '</div>';
        if ($('fu-cancel')) $('fu-cancel').onclick = function () { FL.call('finCancel'); this.disabled = true; };
        if ($('fu-close')) $('fu-close').onclick = function () { F.run = null; box.innerHTML = ''; };
        $('fu-logcopy').onclick = function () { try { navigator.clipboard.writeText(F.log.join('\n')); FL.toast('Log copied', 'ok'); } catch (e) { FL.toast('Copy failed', 'err'); } };
        $('fu-logsave').onclick = function () { F.saveLog(F.log); };
        $('fu-chunks').onchange = function () { F.hideChunks = !this.checked; $('fu-log').classList.toggle('nochunks', F.hideChunks); };
        box.querySelectorAll('.mon-tabs button').forEach(function (b) { b.onclick = function () { R.tab = b.dataset.t; FL.lsSet('mon.tab', R.tab); box.querySelectorAll('.mon-tabs button').forEach(function (x) { x.classList.toggle('on', x === b); }); F.paintPane(); }; });
        // the log so far (the last 1,500 lines)
        var log = $('fu-log');
        log.innerHTML = F.log.slice(-1500).map(function (l) {
            var msg = l.slice(10), cls = /✖|failed/.test(msg) ? 'neg' : /⚠/.test(msg) ? 'warn' : /✓|^Done/.test(msg) ? 'pos' : /^\s*SQL:/.test(msg) ? 'sql' : /· chunk \d+ · rows/.test(msg) ? 'chunk' : /^▶/.test(msg.trim()) ? 'step' : '';
            return '<div class="' + cls + '"><span class="ts">' + esc(l.slice(0, 8)) + '</span>' + esc(msg) + '</div>';
        }).join('');
        log.scrollTop = log.scrollHeight;
        F.paintTimes(); F.paintPane();
    };
    F.paintTimes = function () {
        var R = F.run; if (!R) return;
        if ($('fu-pstat')) $('fu-pstat').textContent = ' · ' + R.chunks.toLocaleString() + ' chunks · ' + R.rows.toLocaleString() + ' rows · ' + F.secs((R.end || Date.now()) - R.t0) +
            (R.running ? ' · ' + Object.keys(R.sql).length + ' quer' + (Object.keys(R.sql).length === 1 ? 'y' : 'ies') + ' running' : '');
        document.querySelectorAll('#mon-pane [data-el]').forEach(function (s) { var q = R.sql[s.dataset.el]; if (q) s.textContent = F.secs(Date.now() - q.t); });
        if ($('mon-nr')) $('mon-nr').textContent = Object.keys(R.sql).length;
    };
    var hiSql = function (sql) {   // light SQL highlighting
        return esc(sql).replace(/\b(SELECT|FROM|WHERE|AND|OR|GROUP BY|ORDER BY|JOIN|ON|IN|CASE|WHEN|THEN|ELSE|END|SUM|MAX|MIN|COUNT|NVL|OVER|ROW_NUMBER|AS|NOT|IS|NULL|DISTINCT|UNION ALL)\b/g, '<b>$1</b>');
    };
    F.paintPane = function () {
        var R = F.run, el = $('mon-pane'); if (!R || !el) return;
        if ($('fu-log')) $('fu-log').style.display = R.tab === 'log' ? '' : 'none';
        if (R.tab === 'log') { el.innerHTML = ''; return; }
        if (R.tab === 'running') {
            var qs = Object.keys(R.sql).map(function (k) { return R.sql[k]; });
            el.innerHTML = qs.length ? qs.map(function (q) {
                return '<div class="mon-q"><div class="row"><i class="fa-solid fa-circle-notch fa-spin"></i><b>' + esc(q.what) + '</b><span class="sm muted">started ' + esc(q.at) + ' · running <span data-el="' + q.id + '">' + F.secs(Date.now() - q.t) + '</span></span><span class="grow"></span>' +
                    '<button class="btn sm" data-copy="' + q.id + '" title="Copy the SQL"><i class="fa-regular fa-copy"></i></button></div><pre class="mon-sql">' + hiSql(q.sql) + '</pre></div>';
            }).join('') : '<p class="sm muted">' + (R.running ? 'Between queries…' : 'Nothing running — see Finished queries, Sample rows and the Log.') + '</p>';
            el.querySelectorAll('[data-copy]').forEach(function (b) { b.onclick = function () { var q = R.sql[b.dataset.copy]; if (q) { try { navigator.clipboard.writeText(q.sql); FL.toast('SQL copied', 'ok'); } catch (e) { /* no clipboard */ } } }; });
        } else if (R.tab === 'done') {
            el.innerHTML = R.done.length ? '<div class="scroll" style="max-height:360px"><table class="t"><thead><tr><th>Step</th><th class="n">Rows</th><th class="n">Time</th><th></th></tr></thead><tbody>' + R.done.map(function (q, i) {
                return '<tr class="click' + (q.skipped ? ' mon-skip' : '') + '" data-i="' + i + '"><td>' + (q.skipped ? '<i class="fa-solid fa-hard-drive" title="Not asked from Fusion: this PC already holds it (tick read again from Fusion to ask)"></i> ' : q.ok ? '' : '<i class="fa-solid fa-circle-xmark neg"></i> ') + esc(q.what) + (q.error ? '<div class="sm neg">' + esc(q.error) + '</div>' : '') + '</td>' +
                    '<td class="n">' + (q.rows || 0).toLocaleString() + '</td><td class="n">' + (q.skipped ? '<span class="sm muted">on this PC</span>' : ((q.ms || 0) / 1000).toFixed(1) + ' s') + '</td>' +
                    '<td class="sm muted" style="white-space:nowrap">SQL › ' + (q.sql ? '<button class="btn sm" data-run="' + i + '" title="Run this query in Fusion now (read-only, first 50 rows shown)"><i class="fa-solid fa-play"></i> Run</button>' : '') + '</td></tr>';
            }).join('') + '</tbody></table></div><p class="sm muted">The last ' + R.done.length + ' queries — click one for its SQL; Run asks Fusion now and shows rows and time.</p>' : '<p class="sm muted">No query finished yet.</p>';
            el.querySelectorAll('tr[data-i]').forEach(function (tr) {
                tr.onclick = function (ev) {
                    if (ev.target.closest('[data-run]')) return;
                    var q = R.done[+tr.dataset.i];
                    var nx = tr.nextElementSibling;
                    if (nx && nx.classList.contains('mon-sqlrow')) { nx.remove(); return; }
                    tr.insertAdjacentHTML('afterend', '<tr class="mon-sqlrow"><td colspan="4"><pre class="mon-sql">' + hiSql(q.sql) + '</pre></td></tr>');
                };
            });
            el.querySelectorAll('[data-run]').forEach(function (b) {
                b.onclick = function () {
                    var q = R.done[+b.dataset.run], tr = b.closest('tr'), nx = tr.nextElementSibling;
                    if (nx && nx.classList.contains('mon-sqlrow')) nx.remove();
                    tr.insertAdjacentHTML('afterend', '<tr class="mon-sqlrow"><td colspan="4"><div class="fu-runres"></div><pre class="mon-sql">' + hiSql(q.sql) + '</pre></td></tr>');
                    F.runSql(q.sql, R.pod || '', tr.nextElementSibling.querySelector('.fu-runres'));
                };
            });
        } else if (R.tab === 'sample') {
            if (!R.samples.length) { el.innerHTML = '<p class="sm muted">The first rows of every step show here as soon as its first chunk comes back.</p>'; return; }
            var ix = Math.min(F.sampleIx || 0, R.samples.length - 1), sm = R.samples[ix];
            el.innerHTML = '<div class="row"><label class="sm">Step <select id="mon-ss">' + R.samples.map(function (x, i) { return '<option value="' + i + '"' + (i === ix ? ' selected' : '') + '>' + esc(x.at + ' · ' + x.what) + '</option>'; }).join('') + '</select></label>' +
                '<span class="sm muted">first ' + sm.rows.length + ' row(s) as Fusion returned them</span></div><div class="scroll" style="max-height:260px"><table class="t mon-sample"><thead><tr>' + sm.cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
                sm.rows.map(function (r) { return '<tr>' + r.map(function (v) { return '<td class="mono">' + esc(v == null ? '' : v) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
            $('mon-ss').onchange = function () { F.sampleIx = +this.value; F.paintPane(); };
        }
    };
    /** Runs one read-only query in Fusion now (host finFusionRun) and shows the rows count, the time and the first rows in `box`. */
    F.runSql = function (sql, pod, box) {
        var t0 = Date.now();
        box.innerHTML = '<div class="sm"><i class="fa-solid fa-circle-notch fa-spin"></i> running in ' + esc(pod || 'the logged-in pod') + '… <span class="fu-runt">0 s</span></div>';
        var tick = setInterval(function () { var t = box.querySelector('.fu-runt'); if (t) t.textContent = F.secs(Date.now() - t0); else clearInterval(tick); }, 1000);
        return FL.call('finFusionRun', { pod: pod, sql: sql }, 6 * 60000).then(function (r) {
            clearInterval(tick);
            box.innerHTML = '<div class="row sm"><span class="tag ' + (r.ok ? 'good' : 'bad') + '">' + (r.ok ? '✓ ' + (r.rows || 0).toLocaleString() + (r.capped ? '+' : '') + ' row(s)' : '✗ failed') + '</span><span class="muted">' + F.secs(r.ms || (Date.now() - t0)) + ' in Fusion</span></div>' +
                (r.error ? '<div class="sm neg">' + esc(r.error) + '</div>' : '') +
                (r.sample && r.sample.length ? '<div class="scroll" style="max-height:240px"><table class="t mon-sample"><thead><tr>' + r.columns.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
                    r.sample.map(function (row) { return '<tr>' + row.map(function (v) { return '<td class="mono">' + esc(v == null ? '' : v) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>' : '');
            return r;
        }).catch(function (e) { clearInterval(tick); box.innerHTML = '<div class="sm neg">' + esc(e && e.message || e) + '</div>'; });
    };
    F.saveLog = function (lines) { FL.download('fusion-sync-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.log', new Blob([lines.join('\r\n')], { type: 'text/plain' })); };
    /** The log of the last sync stays available after the page reloads (this PC). */
    F.lastLogLink = function () { var l = FL.ls('fusion.lastLog', null); return l && l.lines && l.lines.length ? '<p class="sm"><a id="fu-lastlog">Last sync log (' + esc(l.when) + ', ' + l.lines.length + ' lines)</a></p>' : ''; };
    F.wireLastLog = function () { if ($('fu-lastlog')) $('fu-lastlog').onclick = function () { var l = FL.ls('fusion.lastLog', {}); FL.modal('<i class="fa-solid fa-list"></i> Last Fusion sync', '<pre class="fu-log" style="max-height:65vh">' + esc((l.lines || []).join('\n')) + '</pre>', '<button class="btn sm" onclick="FL.fusion.saveLog(FL.ls(\'fusion.lastLog\', {}).lines || [])"><i class="fa-solid fa-download"></i> Save</button>'); }; };
    F.keepLog = function () { FL.lsSet('fusion.lastLog', { when: new Date().toLocaleString(), lines: F.log.slice(-4000) }); };

    F.discover = function (pod) {
        if (F.busy) return;
        F.busy = true;
        var p = F.progress('Discovering ' + (pod || 'the logged-in pod') + '…', true);
        FL.call('finFusionDiscover', { pod: pod }, 30 * 60000, p).then(function (r) {
            F.busy = false;
            F.disc = r.discovery; F.disc.pod = pod; F.discFrom = { where: 'Fusion', at: new Date().toLocaleString() };
            FL.fusion.finish();
            F.showDiscovery();
            F.storeStatus('Saving the chart of accounts…');
            FL.apexStore.saveDiscovery(F.disc, null, null).then(function () { F.storeStatus('✓ Saved in APEX' + (r.savedDuck ? ' and DuckDB' : ' (DuckDB: with the first load)')); })
                .catch(function (e) { F.storeStatus('⚠ Not saved in APEX: ' + (e.message || e) + (r.savedDuck ? ' · saved in DuckDB' : ''), true); });
        }).catch(function (e) { F.busy = false; FL.fusion.finish(e); });
    };

    F.storeStatus = function (t, bad) { F.storeMsg = { t: t, bad: bad }; if ($('fu-store')) { $('fu-store').textContent = t; $('fu-store').className = 'sm ' + (bad ? 'neg' : 'muted'); } };
    F.showDiscovery = function () {
        var d = F.disc, box = $('fu-res'); if (!box || !d) return;
        var from = F.discFrom || {};
        var sv = F.saved() || {}, chosen = {}, setup = sv.setup || {};
        (setup.ledgerIds || (sv.ledgers || []).map(function (l) { return l.id; })).forEach(function (id) { chosen[id] = 1; });
        var leds = (d.ledgers || []).filter(function (l) { return l.coaId; });
        if (!Object.keys(chosen).length) leds.forEach(function (l) { if ((l.category || 'PRIMARY') === 'PRIMARY') chosen[l.id] = 1; });
        var warns = (d.log || []).filter(function (x) { return /^⚠/.test(x); });
        var h = '<div class="callout ' + (from.where === 'Fusion' ? 'good' : '') + ' sm"><i class="fa-solid fa-database"></i> ' +
            (from.where === 'Fusion' ? 'Discovered just now' : 'Saved chart of accounts from <b>' + esc(from.where || '') + '</b> · discovered ' + esc(from.at || d.discoveredAt || '') + (from.by ? ' by ' + esc(from.by) : '') + ' — press Discover to read Fusion again') +
            ' <span id="fu-store" class="sm muted"></span></div>' +
            '<h4 style="margin:14px 0 6px">1 · Ledgers <small class="muted">a dashboard by company needs the ledger of each company — tick the primary ledgers (secondary and reporting ledgers repeat the same companies); this is the default choice in Sync status</small></h4>' +
            '<div class="scroll"><table class="t"><thead><tr><th></th><th>Ledger</th><th>Currency</th><th>Category</th><th>Chart</th><th>Calendar</th><th>Companies (balancing values)</th><th>Open periods</th></tr></thead><tbody>' +
            leds.map(function (l) {
                var open = Object.keys(l.periodStatus || {}).filter(function (k) { return l.periodStatus[k] === 'O'; });
                return '<tr><td><input type="checkbox" class="fu-led" value="' + esc(l.id) + '"' + (chosen[l.id] ? ' checked' : '') + '></td><td><b>' + esc(l.name) + '</b> <span class="muted sm">' + esc(l.shortName || '') + '</span></td><td>' + esc(l.currency) + '</td><td>' + esc(l.category || '') + '</td><td>' + esc(l.coaId) + '</td><td class="sm">' + esc(l.periodSet + ' · ' + l.periodType) + '</td>' +
                    '<td class="sm">' + (l.companies || []).slice(0, 8).map(function (c) { return '<span class="tag">' + esc(c.value) + (c.legalEntity ? ' ' + esc(c.legalEntity) : '') + '</span>'; }).join(' ') + ((l.companies || []).length > 8 ? ' +' + (l.companies.length - 8) : '') + '</td><td class="sm">' + esc(open.slice(-3).join(', ')) + '</td></tr>';
            }).join('') + '</tbody></table></div>';
        h += '<h4 style="margin:14px 0 6px">2 · Chart of accounts segments <small class="muted">found from the qualifiers and measured in GL_CODE_COMBINATIONS — change a role if Fusion is set up differently</small></h4>';
        Object.keys(d.coas || {}).forEach(function (id) {
            var c = d.coas[id], sel = (setup.coa && setup.coa[id]) || (sv.coa && sv.coa[id]) || { company: c.company, costCentre: c.costCentre, account: c.account };
            h += '<div class="card" style="margin:6px 0;padding:10px"><div class="row"><b>Chart ' + esc(id) + '</b><span class="sm muted">' + (c.combinations || 0).toLocaleString() + ' account combinations</span><span class="grow"></span>' +
                Object.keys(c.accountTypes || {}).map(function (t) { return '<span class="tag">' + esc(TYPE[t] || t) + ' ' + c.accountTypes[t].toLocaleString() + '</span>'; }).join(' ') + '</div>' +
                '<table class="t"><thead><tr><th>Column</th><th>Segment</th><th>Qualifiers</th><th class="n">Values</th><th title="Share of the values that carry one account type — the natural account segment is close to 100 %">One type per value</th><th>Role</th></tr></thead><tbody>' +
                c.segments.map(function (s) {
                    var role = Object.keys(ROLE).filter(function (k) { return sel[k] === s.col || (k === 'intercompany' && c.intercompany === s.col && !sel.intercompany); })[0] || '';
                    var pur = Math.round((s.purity || 0) * 100);
                    return '<tr><td class="mono">' + esc(s.col) + '</td><td>' + esc(s.name) + '</td><td>' + (s.qualifiers || []).map(function (q) { return '<span class="tag">' + esc(q) + '</span>'; }).join(' ') + '</td><td class="n">' + (s.distinct || 0).toLocaleString() + '</td>' +
                        '<td><div class="fu-pur"><i style="width:' + pur + '%;background:' + (pur >= 95 ? 'var(--good)' : pur >= 70 ? 'var(--warn)' : 'var(--line2)') + '"></i></div><span class="sm muted">' + pur + ' %</span></td>' +
                        '<td><select class="fu-role" data-coa="' + esc(id) + '" data-col="' + esc(s.col) + '"><option value="">—</option>' + ['company', 'costCentre', 'account'].map(function (k) { return '<option value="' + k + '"' + (role === k ? ' selected' : '') + '>' + ROLE[k] + '</option>'; }).join('') + '</select>' +
                        (role === 'intercompany' ? ' <span class="tag">intercompany</span>' : '') + '</td></tr>';
                }).join('') + '</tbody></table><div class="sm muted" style="margin-top:4px">' + Object.keys(c.why || {}).map(function (k) { return '<b>' + esc(ROLE[k] || k) + ':</b> ' + esc(c.why[k]); }).join(' · ') + '</div></div>';
        });
        h += '<h4 style="margin:14px 0 6px">3 · Save the setup</h4><div class="row"><button class="btn primary" id="fu-save"><i class="fa-solid fa-floppy-disk"></i> Save setup &amp; go to Sync status</button>' +
            '<span class="sm muted">Choose what to load and watch it run (the SQL running now, sample rows, the log) in <b>Data › Sync status</b> · discovered in ' + ((d.ms || 0) / 1000).toFixed(1) + ' s</span></div>' +
            (warns.length ? '<details class="sm" style="margin-top:8px"><summary>' + warns.length + ' Fusion object(s) not available on this pod (other ways were used)</summary>' + warns.map(esc).join('<br>') + '</details>' : '');
        box.innerHTML = h;
        box.querySelectorAll('.fu-role').forEach(function (s) {
            s.onchange = function () {   // one segment per role: clear the role elsewhere in the same chart
                var me = this;
                if (me.value) box.querySelectorAll('.fu-role[data-coa="' + me.dataset.coa + '"]').forEach(function (o) { if (o !== me && o.value === me.value) o.value = ''; });
            };
        });
        $('fu-save').onclick = function () {
            var ids = Array.prototype.map.call(box.querySelectorAll('.fu-led:checked'), function (c) { return c.value; });
            if (!ids.length) { FL.toast('Tick at least one ledger', 'err'); return; }
            var roles = {};
            box.querySelectorAll('.fu-role').forEach(function (s) { var r = roles[s.dataset.coa] = roles[s.dataset.coa] || {}; if (s.value) r[s.value] = s.dataset.col; });
            var bad = leds.filter(function (l) { return ids.indexOf(String(l.id)) >= 0; }).filter(function (l) { var r = roles[l.coaId] || {}; return !r.company || !r.account; });
            if (bad.length) { FL.toast('Choose the company and the natural account segment for ' + bad[0].name, 'err'); return; }
            F.saveSetup(d, roles, ids).then(function () { F.editing = false; FL.toast('Setup saved — choose what to load', 'ok'); FL.dataTab.go('status'); });
        };
    };

    /** Keeps the chosen segment roles and default ledgers (config.json fusion.setup + APEX). */
    F.saveSetup = function (d, roles, ids) {
        FL.config.fusion = Object.assign({}, FL.config.fusion || {}, { setup: { pod: d.pod || '', coa: roles, ledgerIds: ids.map(String), discoveredAt: d.discoveredAt } });
        F.discCache[d.pod || ''] = { disc: d, where: 'this session' };
        FL.apexStore.saveDiscovery(d, roles, ids).catch(function (e) { console.warn('[Finance] roles not saved in APEX', e); });
        return FL.saveConfig();
    };

    /** The discovery of a pod: this session, else APEX (shared), else this PC's DuckDB file. → {disc, where, at, by} or null */
    F.discCache = {};
    F.getDisc = function (pod) {
        pod = pod || '';
        if (F.disc && (F.disc.pod || '') === pod) return Promise.resolve({ disc: F.disc, where: 'this session' });
        if (F.discCache[pod]) return Promise.resolve(F.discCache[pod]);
        return FL.apexStore.loadDiscovery(pod).catch(function () { return null; }).then(function (r) {
            if (r && r.disc) return r;
            return FL.call('finDiscoveryGet', { pod: pod }).then(function (x) { return x && x.found ? { disc: JSON.parse(x.json), where: 'DuckDB', at: x.at, by: x.by } : null; }).catch(function () { return null; });
        }).then(function (r) { if (r) { r.disc.pod = pod; F.discCache[pod] = r; } return r; });
    };
    /** Segment roles per chart: the saved setup / last load, else what discovery decided. */
    F.rolesOf = function (d) {
        var sv = F.saved() || {}, out = {};
        Object.keys(d.coas || {}).forEach(function (id) {
            var c = d.coas[id], r = ((sv.setup || {}).coa || {})[id] || (sv.coa || {})[id];
            out[id] = r && r.company ? r : { company: c.company, costCentre: c.costCentre, account: c.account };
        });
        return out;
    };
    /** A discovered ledger as the host's SyncLedger (with the roles of its chart). */
    F.ledgerFor = function (l, roles) {
        var r = roles[l.coaId] || {}, names = {};
        (l.companies || []).forEach(function (c) { if (c.legalEntity) names[c.value] = c.legalEntity; });
        return { id: l.id, name: l.name, code: l.shortName || String(l.id), currency: l.currency, coaId: l.coaId, periodSet: l.periodSet, periodType: l.periodType, category: l.category,
            company: r.company, costCentre: r.costCentre || null, account: r.account, companyNames: names };
    };
    /** The normal periods of a ledger's calendar: [{name, seq, start, year, num, quarter}] */
    F.calOf = function (d, l) {
        var cal = l ? ((d.calendars || {})[l.periodSet + '|' + l.periodType] || []) : [];
        return cal.filter(function (p) { return !p.adj; }).map(function (p) { return { name: p.name, seq: p.year * 100 + p.num, start: p.start, year: p.year, num: p.num, quarter: p.quarter }; });
    };
    F.defaultIds = function (d) {
        var sv = F.saved() || {}, ids = (sv.setup || {}).ledgerIds || (sv.ledgers || []).map(function (l) { return String(l.id); });
        var leds = (d.ledgers || []).filter(function (l) { return l.coaId; });
        if (!ids.length) ids = leds.filter(function (l) { return (l.category || 'PRIMARY') === 'PRIMARY'; }).map(function (l) { return String(l.id); });
        return ids.map(String);
    };

    // ═════ the load form (Data › Sync status): which ledgers, which months, how to read ═════
    F.loadForm = function (d) {
        var sv = F.saved() || {}, roles = F.rolesOf(d), ids = F.defaultIds(d), leds = (d.ledgers || []).filter(function (l) { return l.coaId; });
        var first = leds.filter(function (l) { return ids.indexOf(String(l.id)) >= 0; })[0] || leds[0];
        F.cal = F.calOf(d, first);
        var today = new Date().toISOString().slice(0, 10), started = F.cal.filter(function (p) { return !p.start || p.start <= today; });
        var to = (started.length ? started[started.length - 1].seq : (F.cal[F.cal.length - 1] || {}).seq);
        if (sv.toSeq && sv.toSeq > to) to = sv.toSeq;
        var toIx = Math.max(0, F.cal.map(function (p) { return p.seq; }).indexOf(to)), from = sv.fromSeq || (F.cal[Math.max(0, toIx - 23)] || {}).seq;
        var opt = function (v) { return F.cal.map(function (p) { return '<option value="' + p.seq + '"' + (p.seq === v ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join(''); };
        var loadedCodes = {}; (sv.ledgers || []).forEach(function (l) { loadedCodes[String(l.id)] = 1; });
        var h = '<h4 style="margin:4px 0 6px">Ledgers to load <small class="muted">tick the ledgers you need — the company dashboards use the ledger of each company</small></h4><div class="lf-leds">' +
            leds.map(function (l) {
                var r = roles[l.coaId] || {}, on = ids.indexOf(String(l.id)) >= 0;
                return '<label class="lf-led' + (on ? ' on' : '') + '"><input type="checkbox" class="lf-led-c" value="' + esc(l.id) + '"' + (on ? ' checked' : '') + '><div><b>' + esc(l.name) + '</b> <span class="tag">' + esc(l.currency) + '</span>' +
                    (loadedCodes[String(l.id)] && (FL.status || {}).loaded ? ' <span class="tag good">loaded</span>' : '') + '<div class="sm muted">' + esc((l.category || '') + ' · chart ' + l.coaId + ' · ' + (l.companies || []).length + ' compan' + ((l.companies || []).length === 1 ? 'y' : 'ies') +
                    ' · company ' + (r.company || '?') + ' / account ' + (r.account || '?') + (r.costCentre ? ' / cost centre ' + r.costCentre : '')) + '</div></div></label>';
            }).join('') + '</div>' +
            '<h4 style="margin:12px 0 6px">What to load</h4><div class="row">' +
            '<label class="sm">From <select id="fu-from">' + opt(from) + '</select></label><label class="sm">To <select id="fu-to">' + opt(to) + '</select></label>' +
            '<label class="sm">Budget <select id="fu-bud"><option value="">none</option>' + (d.budgets || []).map(function (b, i) { return '<option value="' + i + '"' + (sv.budgetId === b.id && sv.budgetSource === b.source ? ' selected' : '') + '>' + esc(b.name + ' (' + b.source + ', ' + (b.rows || 0).toLocaleString() + ' rows)') + '</option>'; }).join('') + '</select></label>' +
            '<label class="sm">Journal lines for drill-down <select id="fu-jm">' + [0, 1, 3, 6, 12, 24].map(function (n) { return '<option value="' + n + '"' + ((sv.journalMonths != null ? sv.journalMonths : 3) === n ? ' selected' : '') + '>' + (n ? 'last ' + n + ' month(s)' : 'none') + '</option>'; }).join('') + '</select></label>' +
            '<label class="sm"><input type="checkbox" id="fu-fold"' + (sv.foldAdjustments === false ? '' : ' checked') + '> fold adjustment periods into the period they close</label></div>' +
            '<div class="row" style="margin-top:6px"><label class="sm" title="Each read is ranked with ROW_NUMBER over its key and limited to this many rows; the next read starts after the last key. A read that times out is repeated at half the size.">Rows per chunk <select id="fu-chunk">' +
            [500, 1000, 2000, 5000, 10000].map(function (n) { return '<option value="' + n + '"' + ((sv.chunkSize || 2000) === n ? ' selected' : '') + '>' + n.toLocaleString() + '</option>'; }).join('') + '</select></label>' +
            '<label class="sm">Reads in parallel <select id="fu-par">' + [1, 2, 3, 4].map(function (n) { return '<option' + ((sv.parallel || 2) === n ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label>' +
            '<label class="sm" title="Each period is read in several smaller queries, one per range of natural account (or company) values, so no single query is big enough to time out.">Split each period <select id="fu-split">' +
            [['none', 'no'], ['account', 'by GL account ranges'], ['company', 'by company']].map(function (x) { return '<option value="' + x[0] + '"' + ((sv.splitBy || 'none') === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></label>' +
            '<label class="sm">values per range <input type="number" id="fu-splitn" min="5" max="2000" value="' + (sv.splitSize || 100) + '" style="width:64px"></label>' +
            '<label class="sm"><input type="checkbox" id="fu-sqllog"' + (sv.logSql ? ' checked' : '') + '> also write the SQL into the log</label></div>' +
            '<div class="row" style="margin-top:12px">' + ((FL.status || {}).loaded ? '<button class="btn primary" id="fu-go-incr" title="Reads the chosen months again and keeps the other months on this PC (a full load runs instead when the ledgers or segments differ from the loaded ones)"><i class="fa-solid fa-rotate"></i> Sync these months</button>' +
            '<button class="btn" id="fu-go-full"><i class="fa-solid fa-cloud-arrow-down"></i> Full reload</button>' : '<button class="btn primary" id="fu-go-full"><i class="fa-solid fa-cloud-arrow-down"></i> Load into Finance Lens</button>') +
            '<span class="sm muted" id="fu-est"></span></div>';
        return h;
    };
    /** Wires the form inside box: ledger chips, calendar follows the first ledger, buttons → F.sync */
    F.wireLoadForm = function (box, d) {
        var est = function () {
            var n = box.querySelectorAll('.lf-led-c:checked').length, a = +$('fu-from').value, b = +$('fu-to').value;
            var months = F.cal.filter(function (p) { return p.seq >= a && p.seq <= b; }).length;
            $('fu-est').textContent = n + ' ledger(s) × ' + months + ' month(s) = ' + (n * months) + ' period reads' + (+$('fu-jm').value ? ' + journals of the last ' + $('fu-jm').value + ' month(s)' : '');
        };
        box.querySelectorAll('.lf-led-c').forEach(function (c) { c.onchange = function () { c.closest('.lf-led').classList.toggle('on', c.checked); est(); }; });
        ['fu-from', 'fu-to', 'fu-jm'].forEach(function (id) { $(id).onchange = est; });
        est();
        var go = function (incr) {
            var o = F.readLoad(box, d); if (!o) return;
            o.incremental = incr;
            var msg = incr ? 'Sync ' + o.ledgers.length + ' ledger(s), ' + F.pname(o.fromSeq) + ' – ' + F.pname(o.toSeq) + ', from Fusion? Other months stay as they are.'
                : 'Load ' + o.ledgers.length + ' ledger(s), ' + F.pname(o.fromSeq) + ' – ' + F.pname(o.toSeq) + ', from Fusion? This replaces the finance data on this PC.';
            if (!confirm(msg)) return;
            FL.apexStore.saveDiscovery(d, o.coa, o.ledgers.map(function (l) { return String(l.id); })).catch(function (e) { console.warn('[Finance] roles not saved in APEX', e); });
            F.sync(o, d);
            if (box.closest('details')) box.closest('details').open = false;
            var mon = $('fu-prog'); if (mon && mon.scrollIntoView) mon.scrollIntoView({ behavior: 'smooth', block: 'start' });
        };
        if ($('fu-go-incr')) $('fu-go-incr').onclick = function () { go(true); };
        $('fu-go-full').onclick = function () { go(false); };
    };
    F.readLoad = function (box, d) {
        var ids = Array.prototype.map.call(box.querySelectorAll('.lf-led-c:checked'), function (c) { return c.value; });
        if (!ids.length) { FL.toast('Tick at least one ledger', 'err'); return null; }
        var roles = F.rolesOf(d), leds = (d.ledgers || []).filter(function (l) { return l.coaId && ids.indexOf(String(l.id)) >= 0; });
        var ledgers = leds.map(function (l) { return F.ledgerFor(l, roles); });
        var bad = ledgers.filter(function (l) { return !l.company || !l.account; });
        if (bad.length) { FL.toast('Choose the company and the natural account segment for ' + bad[0].name + ' in Fusion setup', 'err'); return null; }
        var b = $('fu-bud').value === '' ? null : d.budgets[+$('fu-bud').value];
        var o = { pod: d.pod || '', ledgers: ledgers, fromSeq: +$('fu-from').value, toSeq: +$('fu-to').value, budgetSource: b ? b.source : '', budgetId: b ? b.id : '', budgetName: b ? b.name : '',
            journalMonths: +$('fu-jm').value, foldAdjustments: $('fu-fold').checked, chunkSize: +$('fu-chunk').value, parallel: +$('fu-par').value, logSql: $('fu-sqllog').checked, splitBy: $('fu-split').value, splitSize: +$('fu-splitn').value || 100,
            discoveredAt: d.discoveredAt, coa: roles, calendar: F.cal };
        if (o.toSeq < o.fromSeq) { FL.toast('"From" is after "To"', 'err'); return null; }
        return o;
    };

    F.sync = function (o, disc) {
        if (F.busy) return;
        F.busy = true;
        var p = F.progress('Loading from Fusion…', true), t0 = Date.now();
        var opts = { pod: o.pod, ledgers: o.ledgers, fromSeq: o.fromSeq, toSeq: o.toSeq, budgetSource: o.budgetSource || '', budgetId: o.budgetId || '', journalMonths: o.journalMonths || 0,
            foldAdjustments: o.foldAdjustments !== false, incremental: !!o.incremental, chunkSize: o.chunkSize || 2000, parallel: o.parallel || 2, logSql: !!o.logSql,
            splitBy: o.splitBy || 'none', splitSize: o.splitSize || 100, periodSeqs: o.periodSeqs || [], kinds: o.kinds || [] };
        if (disc) opts.discovery = disc;
        FL.call('finFusionSync', { options: opts }, 6 * 3600000, p).then(function (r) {
            F.busy = false; F.keepLog(); F.finish();
            var base = F.saved() || {};
            FL.config.fusion = r.mode === 'FULL' ? Object.assign({}, base, o) : Object.assign({}, base, { toSeq: Math.max(base.toSeq || 0, o.toSeq), fromSeq: Math.min(base.fromSeq || o.fromSeq, o.fromSeq) });
            delete FL.config.fusion.incremental; delete FL.config.fusion.periodSeqs; delete FL.config.fusion.kinds;
            FL.config.fusion.lastSync = new Date().toISOString();
            FL.config.fusion.lastResult = { balances: r.balances, journals: r.journals, mode: r.mode };
            F.editing = false; F.disc = null;
            return FL.saveConfig().then(function () {
                FL.toast('Loaded ' + r.balances.toLocaleString() + ' balances and ' + r.journals.toLocaleString() + ' journal lines (' + r.mode.toLowerCase() + ') in ' + Math.round((Date.now() - t0) / 1000) + ' s', 'ok');
                if (!o.periodSeqs || !o.periodSeqs.length) FL.lsSet('filter', {});
                if (F.afterSync) { var cb = F.afterSync; F.afterSync = null; setTimeout(cb, 300); }
                return FL.refresh();
            });
        }).catch(function (e) {
            F.busy = false; F.keepLog();
            F.finish(String(e && e.message || e) + ' — the log shows every chunk; it is also saved next to the data as fusion-sync.log. Try fewer rows per chunk, fewer reads in parallel or Split each period.');
        });
    };

    /** Sync chosen periods only (from the status grid): kinds = ['bal'] / ['jnl'] / both; split = 'none' | 'account' | 'company'. */
    F.syncPeriods = function (seqs, kinds, split) {
        var sv = F.saved();
        if (!sv || !sv.ledgers) { FL.toast('Set up the Fusion load first (Data › Sync setup)', 'err'); return; }
        var o = JSON.parse(JSON.stringify(sv));
        o.periodSeqs = seqs; o.kinds = kinds; o.incremental = true;
        if (split) o.splitBy = split;
        F.sync(o);
    };
    /** The classes people chose (APEX, shared) win over this PC's: pulled at start, pushed on every change. */
    F.coaOf = function () { var l = (FL.dims.ledgers || [])[0]; return l && l.coa_id ? String(l.coa_id) : '-'; };
    F.pullMapping = function () {
        if (!FL.apexStore || !FL.dims.accounts.length) return Promise.resolve();
        return FL.apexStore.loadClasses(F.coaOf()).then(function (m) {
            var over = FL.config.accountClass = FL.config.accountClass || {}, changed = {}, n = 0;
            Object.keys(m).forEach(function (code) {
                if (m[code].source !== 'USER' || !m[code].cls) return;
                if (over[code] !== m[code].cls) { over[code] = m[code].cls; n++; }
            });
            FL.apexMap = m;
            if (!n) return;
            FL.dims.accounts.forEach(function (a) { if (over[a.code] && a.class !== over[a.code]) { a.class = over[a.code]; changed[a.code] = a.class; } });
            FL.cache = {};
            return Promise.all([FL.saveConfig(), Object.keys(changed).length ? FL.call('finSetClasses', { classes: changed, source: 'USER' }) : null]).then(function () {
                FL.toast(n + ' account class(es) taken from the shared mapping (APEX)', 'ok');
                if (FL.tab !== 'data') FL.render();
            });
        }).catch(function (e) { console.warn('[Finance] shared mapping not read', e); });
    };

    // ═════ account mapping: class per account → statement lines ═════
    var M = FL.mapping = { q: '', only: 'all', page: 0 };
    FL.specText = function (spec) {
        if (!spec) return '—';
        if (typeof spec === 'object' && !Array.isArray(spec)) {
            var p = [];
            if (spec.type) p.push('type ' + String(spec.type).split('').map(function (t) { return TYPE[t] || t; }).join(' / '));
            if (spec.class) p.push('class ' + [].concat(spec.class).join(', '));
            if (spec.prefix) p.push('starts with ' + [].concat(spec.prefix).join(', '));
            return p.join(' · ');
        }
        return Array.isArray(spec) ? spec.join(', ') : String(spec);
    };
    M.render = function (el) {
        M.el = el;
        var accs = FL.dims.accounts, lines = FINE.accountLines(FL.templates.filter(function (t) { return t.type === 'PL' || t.type === 'BS'; }), accs);
        var main = function (code) { return (lines[code] || []).filter(function (l) { return !(l.row === 'CYE'); }); };
        var plbs = FL.templates.filter(function (t) { return t.id === 'PL' || t.id === 'BS'; });
        var useLines = FINE.accountLines(plbs, accs);
        var probs = { none: 0, dbl: 0 };
        accs.forEach(function (a) { var n = (useLines[a.code] || []).filter(function (l) { return l.row !== 'CYE'; }).length; if (!n) probs.none++; else if (n > 1) probs.dbl++; });
        var q = M.q.toLowerCase(), list = accs.filter(function (a) {
            var n = (useLines[a.code] || []).filter(function (l) { return l.row !== 'CYE'; }).length;
            if (M.only === 'none' && n) return false;
            if (M.only === 'dbl' && n < 2) return false;
            return !q || (a.code + ' ' + a.name + ' ' + (a.class || '')).toLowerCase().indexOf(q) >= 0;
        });
        var auto = FL.templates.some(function (t) { return t.auto; }), over = (FL.config && FL.config.accountClass) || {};
        var shown = list.slice(0, 400);
        el.innerHTML = '<h3><i class="fa-solid fa-diagram-project"></i> Account mapping <small>' + accs.length.toLocaleString() + ' accounts → statement lines' + (auto ? ' by class' : ' by account ranges') + '</small></h3>' +
            '<div class="row" style="margin-bottom:8px"><input id="mp-q" placeholder="Search account, name or class" value="' + esc(M.q) + '" style="flex:1;min-width:180px">' +
            '<div class="seg" id="mp-only">' + [['all', 'All'], ['none', 'In no line (' + probs.none + ')'], ['dbl', 'In two lines (' + probs.dbl + ')']].map(function (x) { return '<button data-o="' + x[0] + '" class="' + (M.only === x[0] ? 'on' : '') + '">' + esc(x[1]) + '</button>'; }).join('') + '</div>' +
            '<button class="btn sm" id="mp-rebuild" title="Replace PL, PLS, BS and CF with the default statements built on the account classes (your other templates stay)"><i class="fa-solid fa-wand-magic-sparkles"></i> Rebuild default statements</button>' +
            '<button class="btn sm" id="mp-apex" title="Store the class of every account in APEX (WMS_FIN_ACCOUNT_MAP) so other PCs and the next load use the same mapping"><i class="fa-solid fa-cloud-arrow-up"></i> Save all to APEX</button></div>' +
            '<p class="sm muted">Saved: your choices in APEX <code>WMS_FIN_ACCOUNT_MAP</code> (shared, by chart ' + esc(F.coaOf()) + '), DuckDB <code>fin_account_map</code> + <code>fin_accounts.class</code>, and config.json — every load keeps them.</p>' +
            (!auto ? '<p class="sm muted">These templates pick accounts by ranges — a class change here moves an account only in templates built from classes.</p>' : '') +
            '<div class="scroll" style="max-height:420px"><table class="t"><thead><tr><th>Account</th><th>Name</th><th>Type</th><th>Class</th><th>Income statement / balance sheet line</th></tr></thead><tbody>' +
            shown.map(function (a) {
                var ls = main(a.code), cls = FINE.CLASSES[a.account_type] || [];
                if (a.class && cls.indexOf(a.class) < 0) cls = cls.concat([a.class]);
                return '<tr' + (!ls.length ? ' class="neg"' : ls.length > 1 ? ' class="warnrow"' : '') + '><td class="mono">' + esc(a.code) + '</td><td>' + esc(a.name) + '</td><td>' + esc(TYPE[a.account_type] || a.account_type || '') + '</td>' +
                    '<td><select class="mp-cls" data-code="' + esc(a.code) + '">' + cls.map(function (c) { return '<option' + (c === a.class ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' + (over[a.code] ? ' <i class="fa-solid fa-user-pen muted" title="Set by you"></i>' : '') + '</td>' +
                    '<td class="sm">' + (ls.length ? ls.map(function (l) { return '<a class="mp-line" data-t="' + esc(l.tpl) + '" data-r="' + esc(l.row) + '">' + esc(l.tpl + ' › ' + l.label) + '</a>'; }).join('<br>') : '<b>in no line — left out of the totals</b>') + '</td></tr>';
            }).join('') + '</tbody></table>' + (list.length > shown.length ? '<p class="sm muted">First 400 of ' + list.length.toLocaleString() + ' — search to narrow.</p>' : '') + '</div>';
        $('mp-q').oninput = function () { M.q = this.value; clearTimeout(M.t); M.t = setTimeout(function () { M.render(el); var i = $('mp-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
        el.querySelectorAll('#mp-only button').forEach(function (b) { b.onclick = function () { M.only = b.dataset.o; M.render(el); }; });
        el.querySelectorAll('.mp-cls').forEach(function (s) { s.onchange = function () { M.setClass(s.dataset.code, s.value); }; });
        el.querySelectorAll('.mp-line').forEach(function (a) { a.onclick = function () { FL.rowMap(FL.tpl(a.dataset.t), a.dataset.r); }; });
        $('mp-apex').onclick = function () {
            var btn = this; btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving…';
            FL.apexStore.saveClasses(F.coaOf(), accs.map(function (a) { return { code: a.code, name: a.name, type: a.account_type, cls: a.class, source: over[a.code] ? 'USER' : 'AUTO' }; }))
                .then(function () { FL.toast(accs.length + ' account classes saved in APEX', 'ok'); }).catch(function (e) { FL.toast('APEX: ' + (e.message || e), 'err'); })
                .then(function () { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Save all to APEX'; });
        };
        $('mp-rebuild').onclick = function () {
            if (!confirm('Replace the PL, PLS, BS and CF templates with the default statements built from the account classes? Your other templates stay.')) return;
            var fresh = FINE.autoTemplates().map(function (t) {
                return t.id === 'PL' || t.id === 'BS' ? FINE.simpleTemplate({ id: t.id, name: t.id === 'PL' ? 'Income statement' : 'Balance sheet', simple: FINE.simpleDefault(t.id, accs), description: 'Default mapping from the account types and names — change it in the Statement builder.' }) : t;
            }), ids = fresh.map(function (t) { return t.id; });
            FL.templates = fresh.concat(FL.templates.filter(function (t) { return ids.indexOf(t.id) < 0; }));
            FL.saveTemplates().then(function () { FL.templatesSaved = true; FL.cache = {}; FL.toast('Statements rebuilt from the account classes', 'ok'); M.render(el); });
        };
    };
    M.setClass = function (code, cls) {
        FL.config.accountClass = FL.config.accountClass || {};
        FL.config.accountClass[code] = cls;
        FL.dims.accounts.forEach(function (a) { if (a.code === code) a.class = cls; });
        // simple statements hold accounts by section: move the account to the section of its new class
        var moved = 0;
        FL.templates.forEach(function (t) {
            if (!t.simple || !(t.simple.lines || []).some(function (l) { return (l.sections || []).some(function (x) { return (x.accounts || []).indexOf(code) >= 0; }); })) return;
            t.simple.lines.forEach(function (l) { (l.sections || []).forEach(function (x) { x.accounts = (x.accounts || []).filter(function (c) { return c !== code; }); }); });
            FINE.simplePlace(t.simple, FL.dims.accounts, [code]); FINE.simpleTemplate(t); moved++;
        });
        if (moved) FL.saveTemplates();
        var ch = {}; ch[code] = cls;
        var acc = FL.dims.accounts.filter(function (a) { return a.code === code; })[0] || {};
        var apex = FL.apexStore ? FL.apexStore.saveClasses(F.coaOf(), [{ code: code, name: acc.name, type: acc.account_type, cls: cls, source: 'USER' }]).then(function () { return 'APEX'; }).catch(function (e) { console.warn(e); return 'not APEX (' + (e.message || e) + ')'; }) : Promise.resolve('');
        Promise.all([FL.saveConfig(), FL.call('finSetClasses', { classes: ch, source: 'USER' }), apex]).then(function (r) { FL.cache = {}; FL.toast(code + ' → ' + cls + ' · saved on this PC, in DuckDB and ' + r[2], 'ok'); if (M.el && document.body.contains(M.el)) M.render(M.el); })
            .catch(function (e) { FL.toast(String(e), 'err'); });
    };

    // ═════ drill: a statement line → the accounts mapped to it ═════
    FL.rowMap = function (tpl, rowId) {
        if (!tpl) return;
        var row = (tpl.rows || []).filter(function (r) { return r.id === rowId; })[0];
        if (!row) return;
        FL.data().then(function (data) {
            var opts = FL.stmtOpts(), st = FINE.compute(tpl, data, opts), cols = st.columns.filter(function (c) { return c.kind === 'value'; }).slice(0, 4);
            var srow = st.rows.filter(function (r) { return r.id === rowId; })[0] || { values: [] };
            var head = '<div class="crumbs">' + esc(tpl.name) + ' › <b>' + esc(row.label) + '</b> · ' + esc(FL.filterText()) + '</div>';
            var info = [['Line type', row.type], ['Mapping', row.type === 'accounts' ? FL.specText(row.accounts) : row.type === 'group' ? 'sum of the lines below' : row.formula || ''],
                ['Basis', row.type === 'accounts' ? ({ activity: 'movement in the window', balance: 'closing balance', change: 'change (closing − opening)', opening: 'opening balance' }[row.basis] || (tpl.type === 'BS' ? 'closing balance' : 'movement in the window')) : ''],
                ['Sign', row.type === 'accounts' ? (row.sign || 'auto') : '']].filter(function (x) { return x[1]; });
            var html = head + '<table class="t" style="margin-bottom:10px"><tbody>' + info.map(function (x) { return '<tr><td class="muted" style="width:120px">' + esc(x[0]) + '</td><td>' + esc(x[1]) + '</td></tr>'; }).join('') + '</tbody></table>';
            if (row.type === 'accounts') {
                var per = {};
                cols.forEach(function (c) { FINE.explain(tpl, data, opts, rowId, c.id).forEach(function (a) { (per[a.code] = per[a.code] || { code: a.code, name: a.name, v: {} }).v[c.id] = a.amount; }); });
                var codes = FINE.matchAccounts(row.accounts, data.accounts), byCode = {}; data.accounts.forEach(function (a) { byCode[a.code] = a; });
                var list = codes.map(function (c) { var a = byCode[c] || {}; return { code: c, name: a.name, type: a.account_type, cls: a.class, v: (per[c] || { v: {} }).v }; });
                FL.rmList = list;
                html += '<p class="sm muted">' + list.length + ' account(s) mapped to this line · amounts in ' + FL.scaleLabel() + ' · click an account for companies, cost centres, months and journals</p><div class="scroll" style="max-height:52vh">' +
                    FL.table([{ label: 'Account', key: 'code' }, { label: 'Name', key: 'name' }, { label: 'Type', get: function (r) { return TYPE[r.type] || r.type || ''; } }, { label: 'Class', key: 'cls' }]
                        .concat(cols.map(function (c) { return { label: c.label, n: 1, get: function (r) { return r.v[c.id] == null ? '' : FL.num(r.v[c.id]); } }; })), list, { click: true }) + '</div>' +
                    '<p class="sm">Total ' + cols.map(function (c, i) { var ix = st.columns.indexOf(c); return esc(c.label) + ' <b>' + FL.cellText(row, c, srow.values[ix]) + '</b>'; }).join(' · ') + '</p>';
            } else {
                var kids = row.type === 'group' ? tpl.rows.filter(function (r) { return r.parent === rowId; }) : FINE.refs(FINE.parse(row.formula || '0'), []).map(function (id) { return tpl.rows.filter(function (r) { return r.id === id; })[0]; }).filter(Boolean);
                html += '<p class="sm muted">Made of these lines — click one for its accounts</p>' + FL.table([{ label: 'Line', key: 'label' }, { label: 'Type', key: 'type' }].concat(cols.map(function (c) {
                    var ix = st.columns.indexOf(c);
                    return { label: c.label, n: 1, get: function (r) { var s = st.rows.filter(function (x) { return x.id === r.id; })[0]; return s ? FL.cellText(r, c, s.values[ix]) : ''; } };
                })), kids, { click: true });
                FL.rmKids = kids;
            }
            FL.modal('<i class="fa-solid fa-diagram-project"></i> ' + esc(row.label) + ' — mapped accounts', html,
                '<button class="btn sm" id="rm-ask"><i class="fa-solid fa-wand-magic-sparkles"></i> Ask the Copilot</button><button class="btn sm" id="rm-edit"><i class="fa-solid fa-pen-ruler"></i> Edit line</button>' + (row.type === 'accounts' ? '<button class="btn sm" id="rm-csv"><i class="fa-solid fa-file-csv"></i> CSV</button>' : ''));
            $('rm-edit').onclick = function () { FL.closeModal(); FL.designer.open(tpl.id); };
            $('rm-ask').onclick = function () { FL.closeModal(); FL.askCopilot('Explain "' + row.label + '" in the ' + tpl.name + ' for ' + FL.periodName(opts.period) + ': what drives it against budget and last year, by account, cost centre and month?'); };
            if ($('rm-csv')) $('rm-csv').onclick = function () { FL.csv(tpl.id + '-' + rowId + '-accounts.csv', ['account', 'name', 'type', 'class'].concat(cols.map(function (c) { return c.label; })), FL.rmList.map(function (r) { return [r.code, r.name, r.type, r.cls].concat(cols.map(function (c) { return r.v[c.id] == null ? '' : r.v[c.id].toFixed(2); })); })); };
            if (row.type === 'accounts') {
                var c0 = cols[0], seqs = c0 ? FINE.windowSeqs(c0, data, opts.period) : [];
                FL.wireRows($('m-body'), FL.rmList, function (a) { FL.drillAccount(a.code, { tpl: tpl, row: row, col: c0 || {}, seqs: seqs, label: row.label + (c0 ? ' · ' + FINE.colLabel(c0, data._pi, opts.period) : '') }); });
            } else FL.wireRows($('m-body'), FL.rmKids, function (r) { FL.rowMap(tpl, r.id); });
        }).catch(function (e) { FL.toast(String(e && e.message || e), 'err'); });
    };
})();
