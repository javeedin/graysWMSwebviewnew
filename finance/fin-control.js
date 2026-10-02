/* Finance Lens — KPIs & monitor (rules, 12-month status, KPI library editor), Journal risk (Benford, timing, round
   amounts, manual journals, duplicates, suspense, rare users, late postings, a risk score per journal), Close checks
   (period readiness) and Data (status, sample load, folder, read-only SQL explorer, chart of accounts). */
(function () {
    var T = function () { return FL.tplMap(); };

    // ═════════ KPIs & monitor ═════════
    FL.TABS.monitor = {
        render: function (el) {
            return FL.data().then(function (data) {
                var cfg = FL.config, tm = T(), pi = data._pi || (data._pi = FINE.periodIndex(data.periods)), i = pi.bySeq[FL.filter.period];
                var hist = [];
                for (var k = Math.max(0, i - 11); k <= i; k++) { var kv = FINE.kpis(cfg.kpis, tm, data, pi.list[k].period_seq); hist.push({ p: pi.list[k], kv: kv, mon: FINE.monitor(cfg.monitors, kv) }); }
                var now = hist[hist.length - 1];
                var kdef = function (id) { return cfg.kpis.filter(function (x) { return x.id === id; })[0] || {}; };
                var breaches = now.mon.filter(function (m) { return m.status === 'breach'; });
                el.innerHTML = '<div class="grid g2"><div class="card"><h3><i class="fa-solid fa-heart-pulse"></i> Monitors · ' + esc(FL.periodName(FL.filter.period)) + '<span class="grow"></span>' +
                    (breaches.length ? '<span class="tag bad">' + breaches.length + ' alert(s)</span>' : '<span class="tag good">all OK</span>') + '</h3>' +
                    '<table class="t"><thead><tr><th>Rule</th><th>Severity</th><th class="n">Now</th><th>Last 12 months</th><th></th></tr></thead><tbody>' +
                    cfg.monitors.map(function (r, ri) {
                        var m = now.mon[ri], d = kdef(r.kpi);
                        return '<tr><td>' + esc(r.label) + '<div class="sm muted">' + esc(d.label || r.kpi) + ' ' + esc(r.op) + ' ' + FL.kfmt(+r.value, d.fmt) + '</div></td><td><span class="tag ' + (r.severity === 'critical' ? 'critical' : r.severity === 'high' ? 'bad' : 'warn') + '">' + esc(r.severity) + '</span></td>' +
                            '<td class="n"><span class="tag ' + (m.status === 'breach' ? 'bad' : m.status === 'ok' ? 'good' : '') + '">' + FL.kfmt(m.value, d.fmt) + '</span></td>' +
                            '<td><div class="strip">' + hist.map(function (h) { var x = h.mon[ri]; return '<span class="' + x.status + '" title="' + esc(h.p.period_name + ': ' + FL.kfmt(x.value, d.fmt)) + '"></span>'; }).join('') + '</div></td>' +
                            '<td><button class="icon" data-ed="' + ri + '" title="Edit"><i class="fa-solid fa-pen"></i></button><button class="icon" data-del="' + ri + '" title="Remove"><i class="fa-regular fa-trash-can"></i></button></td></tr>';
                    }).join('') + '</tbody></table><div class="row" style="margin-top:8px"><button class="btn sm" id="mo-add"><i class="fa-solid fa-plus"></i> Rule</button></div></div>' +
                    '<div class="card"><h3><i class="fa-solid fa-calculator"></i> KPI library <small>' + cfg.kpis.length + ' formulas — click to edit</small><span class="grow"></span><button class="btn sm" id="kp-add"><i class="fa-solid fa-plus"></i> KPI</button></h3>' +
                    '<div class="scroll" style="max-height:62vh"><table class="t"><thead><tr><th>Group</th><th>KPI</th><th class="n">Value</th><th>Formula</th></tr></thead><tbody>' +
                    cfg.kpis.map(function (k, ki) { var v = now.kv[k.id]; return '<tr class="click" data-k="' + ki + '"><td class="muted">' + esc(k.group || '') + '</td><td>' + esc(k.label) + '</td><td class="n">' + (v && v.error ? '<span class="tag bad" title="' + esc(v.error) + '">error</span>' : FL.kfmt(v && v.value, k.fmt)) + '</td><td class="mono sm">' + esc(k.expr) + '</td></tr>'; }).join('') +
                    '</tbody></table></div><p class="formhelp">Formulas use template rows: <code>PL.NP@YTD</code>, <code>BS.AR@BAL</code>, <code>CF.OPC@LTM</code>; windows ' + FINE.WINDOWS.map(function (w) { return '<code>@' + w + '</code>'; }).join(' ') +
                    '; functions ' + FINE.FUNCTIONS.map(function (f) { return '<code>' + f + '</code>'; }).join(' ') + '; earlier KPIs by id (<code>dso + dio - dpo</code>).</p></div></div>';
                el.querySelectorAll('[data-ed]').forEach(function (b) { b.onclick = function () { FL.ruleEdit(+b.dataset.ed); }; });
                el.querySelectorAll('[data-del]').forEach(function (b) { b.onclick = function () { if (!confirm('Remove this monitor?')) return; cfg.monitors.splice(+b.dataset.del, 1); FL.saveConfig().then(FL.render); }; });
                $('mo-add').onclick = function () { FL.ruleEdit(-1); };
                $('kp-add').onclick = function () { FL.kpiEdit(-1); };
                el.querySelectorAll('tr.click[data-k]').forEach(function (r) { r.onclick = function () { FL.kpiEdit(+r.dataset.k); }; });
            });
        }
    };
    FL.ruleEdit = function (ix) {
        var cfg = FL.config, r = ix >= 0 ? cfg.monitors[ix] : { id: 'm' + Date.now().toString(36), kpi: cfg.kpis[0].id, op: '<', value: 0, severity: 'medium', label: '' };
        FL.modal('<i class="fa-solid fa-heart-pulse"></i> Monitor rule', '<div class="grid g2">' +
            '<label class="field">Label<input id="r-l" value="' + esc(r.label) + '"></label>' +
            '<label class="field">KPI<select id="r-k">' + cfg.kpis.map(function (k) { return '<option value="' + esc(k.id) + '"' + (k.id === r.kpi ? ' selected' : '') + '>' + esc(k.group + ' · ' + k.label) + '</option>'; }).join('') + '</select></label>' +
            '<label class="field">Alert when the KPI is<select id="r-o">' + ['<', '<=', '>', '>=', '=', '<>'].map(function (o) { return '<option' + (o === r.op ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select></label>' +
            '<label class="field">Value<input id="r-v" type="number" step="any" value="' + esc(r.value) + '"></label>' +
            '<label class="field">Severity<select id="r-s">' + ['low', 'medium', 'high', 'critical'].map(function (o) { return '<option' + (o === r.severity ? ' selected' : '') + '>' + o + '</option>'; }).join('') + '</select></label></div>' +
            '<div class="row" style="margin-top:12px"><span class="grow"></span><button class="btn primary" id="r-save"><i class="fa-solid fa-floppy-disk"></i> Save</button></div>');
        $('r-save').onclick = function () {
            Object.assign(r, { label: $('r-l').value || ($('r-k').selectedOptions[0].text + ' ' + $('r-o').value + ' ' + $('r-v').value), kpi: $('r-k').value, op: $('r-o').value, value: +$('r-v').value, severity: $('r-s').value });
            if (ix < 0) cfg.monitors.push(r);
            FL.saveConfig().then(function () { FL.closeModal(); FL.render(); FL.toast('Saved', 'ok'); }).catch(function (e) { FL.toast(String(e), 'err'); });
        };
    };
    FL.kpiEdit = function (ix) {
        var cfg = FL.config, k = ix >= 0 ? cfg.kpis[ix] : { id: '', group: 'Custom', label: '', expr: '', fmt: 'num', good: 'up', desc: '' };
        FL.modal('<i class="fa-solid fa-calculator"></i> KPI', '<div class="grid g2">' +
            '<label class="field">Id (letters, digits, _)<input id="k-id" value="' + esc(k.id) + '"' + (ix >= 0 ? ' disabled' : '') + '></label>' +
            '<label class="field">Label<input id="k-l" value="' + esc(k.label) + '"></label>' +
            '<label class="field">Group<input id="k-g" value="' + esc(k.group || '') + '"></label>' +
            '<label class="field">Format<select id="k-f">' + [['money', 'Money'], ['pct', '%'], ['ratio', 'Ratio ×'], ['days', 'Days'], ['num', 'Number']].map(function (f) { return '<option value="' + f[0] + '"' + (f[0] === k.fmt ? ' selected' : '') + '>' + f[1] + '</option>'; }).join('') + '</select></label>' +
            '<label class="field">Good when it goes<select id="k-gd"><option value="up"' + (k.good !== 'down' ? ' selected' : '') + '>up</option><option value="down"' + (k.good === 'down' ? ' selected' : '') + '>down</option></select></label>' +
            '<label class="field">Description<input id="k-d" value="' + esc(k.desc || '') + '"></label></div>' +
            '<label class="field" style="margin-top:8px">Formula<input id="k-e" class="mono" value="' + esc(k.expr) + '" placeholder="PCT(PL.EBITDA@YTD, PL.REV@YTD)"></label>' +
            '<div class="row" style="margin-top:6px"><button class="btn sm" id="k-t"><i class="fa-solid fa-play"></i> Test</button><span id="k-r" class="sm"></span><span class="grow"></span>' +
            (ix >= 0 ? '<button class="btn sm" id="k-del"><i class="fa-regular fa-trash-can"></i> Delete</button>' : '') + '<button class="btn primary" id="k-s"><i class="fa-solid fa-floppy-disk"></i> Save</button></div>' +
            '<p class="formhelp">Rows: ' + FL.templates.map(function (t) { return '<b>' + esc(t.id) + '</b>: ' + t.rows.filter(function (r) { return r.id && r.type !== 'header' && r.type !== 'blank' && r.type !== 'text'; }).map(function (r) { return '<code>' + esc(r.id) + '</code>'; }).join(' '); }).join('<br>') + '</p>');
        var test = function () {
            var def = { id: ($('k-id').value || 'x').trim(), expr: $('k-e').value, fmt: $('k-f').value };
            return FL.data().then(function (data) {
                var others = cfg.kpis.filter(function (x) { return x.id !== def.id; });
                var v = FINE.kpis(others.concat([def]), T(), data, FL.filter.period)[def.id];
                $('k-r').innerHTML = v.error ? '<span class="neg">' + esc(v.error) + '</span>' : '= <b>' + FL.kfmt(v.value, def.fmt) + '</b> for ' + esc(FL.periodName(FL.filter.period));
                return !v.error;
            });
        };
        $('k-t').onclick = test;
        if ($('k-del')) $('k-del').onclick = function () { if (!confirm('Delete this KPI?')) return; cfg.kpis.splice(ix, 1); FL.saveConfig().then(function () { FL.closeModal(); FL.render(); }); };
        $('k-s').onclick = function () {
            var id = $('k-id').value.trim();
            if (!/^[A-Za-z_]\w*$/.test(id)) { FL.toast('Give the KPI an id (letters, digits, _)', 'err'); return; }
            if (ix < 0 && cfg.kpis.some(function (x) { return x.id === id; })) { FL.toast('That id is taken', 'err'); return; }
            test().then(function (ok) {
                if (!ok && !confirm('The formula has an error. Save anyway?')) return;
                Object.assign(k, { id: id, label: $('k-l').value || id, group: $('k-g').value, fmt: $('k-f').value, good: $('k-gd').value, desc: $('k-d').value, expr: $('k-e').value });
                if (ix < 0) cfg.kpis.push(k);
                return FL.saveConfig().then(function () { FL.closeModal(); FL.render(); FL.toast('Saved', 'ok'); });
            }).catch(function (e) { FL.toast(String(e), 'err'); });
        };
    };

    // ═════════ Journal risk ═════════
    var J = { win: FL.ls('jr.win', 'YTD') };
    FL.TABS.journals = {
        render: function (el) {
            var jr = FL.config.journalRisk || {}, man = (jr.manualSources || ['Manual']).map(FL.q).join(',');
            return FL.data().then(function (data) {
                var seqs = J.win === 'ALL' ? data.periods.map(function (p) { return p.period_seq; }) : FINE.windowSeqs({ range: J.win }, data, FL.filter.period);
                var base = FL.where('j').concat(['j.period_seq IN (' + seqs.join(',') + ')']).join(' AND ');
                var susp = FL.dims.accounts.filter(function (a) { return /suspense/i.test(a.class || '') || /suspense/i.test(a.name || ''); }).map(function (a) { return FL.q(a.code); });
                var amt = '(j.dr + j.cr)';
                var TESTS = [
                    { id: 'weekend', label: 'Posted at the weekend', why: 'Saturday / Sunday postings bypass the normal review rhythm', w: 'dayofweek(j.posted_at) IN (0, 6)' },
                    { id: 'hours', label: 'Posted out of hours', why: 'Before ' + (jr.beforeHour || 7) + ':00 or after ' + (jr.afterHour || 20) + ':00', w: '(hour(j.posted_at) >= ' + (+jr.afterHour || 20) + ' OR hour(j.posted_at) < ' + (+jr.beforeHour || 7) + ")" },
                    { id: 'round', label: 'Round-amount manual journals', why: 'Manual lines in exact multiples of ' + FL.compact(jr.roundTo || 10000) + ' are often estimates or plugs', w: 'j.je_source IN (' + man + ') AND ' + amt + ' >= ' + (+jr.roundTo || 10000) + ' AND CAST(' + amt + ' AS DECIMAL(18,2)) % ' + (+jr.roundTo || 10000) + ' = 0' },
                    { id: 'large', label: 'Large manual journals', why: 'Manual lines of ' + FL.compact(jr.bigManual || 1000000) + ' or more', w: 'j.je_source IN (' + man + ') AND ' + amt + ' >= ' + (+jr.bigManual || 1000000) },
                    { id: 'dup', label: 'Possible duplicates', why: 'Same company, account, amount, date and source in more than one journal', w: 'j.je_id IN (SELECT UNNEST(LIST(DISTINCT je_id)) FROM fin_journals x WHERE x.period_seq IN (' + seqs.join(',') + ') AND x.dr + x.cr > 0 GROUP BY x.company, x.account, x.dr, x.cr, x.accounting_date, x.je_source HAVING COUNT(DISTINCT x.je_id) > 1)' },
                    { id: 'susp', label: 'Suspense postings', why: 'Lines to suspense / unallocated accounts', w: susp.length ? 'j.account IN (' + susp.join(',') + ')' : '1 = 0' },
                    { id: 'late', label: 'Posted long after the period end', why: 'More than 5 days after the period closed', w: 'j.posted_at > (SELECT p.end_date FROM fin_periods p WHERE p.period_seq = j.period_seq) + INTERVAL 5 DAY' },
                    { id: 'rare', label: 'Posted by rare users', why: 'Users with fewer than 2 % of the journals in the window', w: 'j.created_by IN (SELECT created_by FROM fin_journals x WHERE x.period_seq IN (' + seqs.join(',') + ') GROUP BY created_by HAVING COUNT(DISTINCT je_id) < 0.02 * (SELECT COUNT(DISTINCT je_id) FROM fin_journals y WHERE y.period_seq IN (' + seqs.join(',') + ')))' }
                ];
                var qs = [
                    'SELECT COUNT(DISTINCT j.je_id) AS jes, COUNT(*) AS lines, COUNT(DISTINCT j.created_by) AS users, SUM(j.dr) AS total, COUNT(DISTINCT j.je_id) FILTER (WHERE j.je_source IN (' + man + ')) AS manual FROM fin_journals j WHERE ' + base,
                    "SELECT CAST(left(regexp_replace(CAST(CAST(FLOOR(j.dr + j.cr) AS BIGINT) AS VARCHAR), '^0+', ''), 1) AS INTEGER) AS d, COUNT(*) AS n FROM fin_journals j WHERE " + base + ' AND j.dr + j.cr >= 10 GROUP BY 1',
                    'SELECT ' + TESTS.map(function (t) { return 'COUNT(DISTINCT j.je_id) FILTER (WHERE ' + t.w + ') AS "' + t.id + '"'; }).join(', ') + ' FROM fin_journals j WHERE ' + base,
                    'SELECT j.je_source AS source, COUNT(DISTINCT j.je_id) AS jes, SUM(j.dr) AS amount FROM fin_journals j WHERE ' + base + ' GROUP BY 1 ORDER BY 2 DESC',
                    'SELECT j.created_by AS who, COUNT(DISTINCT j.je_id) AS jes, COUNT(DISTINCT j.je_id) FILTER (WHERE j.je_source IN (' + man + ')) AS manual, SUM(j.dr) AS amount FROM fin_journals j WHERE ' + base + ' GROUP BY 1 ORDER BY 2 DESC',
                    'SELECT hour(j.posted_at) AS h, COUNT(DISTINCT j.je_id) AS n FROM fin_journals j WHERE ' + base + ' GROUP BY 1 ORDER BY 1',
                    'SELECT j.je_id, any_value(j.je_name) AS je_name, any_value(j.je_source) AS source, any_value(j.created_by) AS who, CAST(any_value(j.accounting_date) AS VARCHAR) AS acc_date, SUM(j.dr) AS amount, ' +
                        TESTS.map(function (t) { return 'MAX(CASE WHEN ' + t.w + ' THEN 1 ELSE 0 END)'; }).join(' + ') + ' AS score, ' +
                        "concat_ws(', ', " + TESTS.map(function (t) { return 'CASE WHEN MAX(CASE WHEN ' + t.w + " THEN 1 ELSE 0 END) = 1 THEN '" + t.label.toLowerCase() + "' END"; }).join(', ') + ') AS flags FROM fin_journals j WHERE ' + base + ' GROUP BY j.je_id HAVING score > 0 ORDER BY score DESC, amount DESC LIMIT 30'
                ];
                return FL.call('finQueries', { queries: qs }, 180000).then(function (res) {
                    if (!res.ok) throw res.error;
                    var R = res.results, sum = R[0].rows[0] || [], tc = R[2].rows[0] || [];
                    var counts = {}; R[1].rows.forEach(function (r) { counts[r[0]] = r[1]; });
                    var ben = FINE.benfordCounts(counts);
                    var obj = function (r) { var o = {}; r.columns.forEach(function (c, i) { o[c] = null; }); return r.rows.map(function (x) { var y = {}; r.columns.forEach(function (c, i) { y[c] = x[i]; }); return y; }); };
                    var top = obj(R[6]);
                    el.innerHTML = '<div class="row" style="margin-bottom:10px"><h2 style="margin:0;font-size:1.05rem">Journal risk</h2><span class="muted sm">' + esc(FL.filterText()) + '</span><span class="grow"></span><div class="seg" id="jr-w">' +
                        [['MTD', 'This month'], ['QTD', 'Quarter'], ['YTD', 'Year to date'], ['LTM', '12 months'], ['ALL', 'All']].map(function (w) { return '<button data-w="' + w[0] + '" class="' + (J.win === w[0] ? 'on' : '') + '">' + w[1] + '</button>'; }).join('') + '</div></div>' +
                        '<div class="kpis"><div class="kpi"><div class="k-l">Journals</div><div class="k-v">' + (sum[0] || 0).toLocaleString() + '</div><div class="k-d muted">' + (sum[1] || 0).toLocaleString() + ' lines</div></div>' +
                        '<div class="kpi"><div class="k-l">Manual journals</div><div class="k-v">' + (sum[4] || 0).toLocaleString() + '</div><div class="k-d muted">' + (sum[0] ? (sum[4] / sum[0] * 100).toFixed(1) : 0) + ' % of all</div></div>' +
                        '<div class="kpi"><div class="k-l">People posting</div><div class="k-v">' + (sum[2] || 0) + '</div><div class="k-d muted">incl. SYSTEM</div></div>' +
                        '<div class="kpi"><div class="k-l">Value posted (debits)</div><div class="k-v">' + FL.compact(sum[3]) + '</div><div class="k-d muted">&nbsp;</div></div>' +
                        '<div class="kpi"><div class="k-l">Benford (first digits)</div><div class="k-v" style="font-size:1.05rem">' + esc(ben.verdict) + '</div><div class="k-d muted">MAD ' + ben.mad.toFixed(4) + ' · ' + ben.n.toLocaleString() + ' amounts</div></div></div>' +
                        '<div class="grid g2" style="margin-top:12px"><div class="card"><h3><i class="fa-solid fa-shield-halved"></i> Tests <small>click to see the journals</small></h3><table class="t"><tbody>' +
                        TESTS.map(function (t, i) { return '<tr class="click" data-t="' + i + '"><td><b>' + esc(t.label) + '</b><div class="sm muted">' + esc(t.why) + '</div></td><td class="n"><span class="tag ' + (tc[i] ? 'warn' : 'good') + '">' + (tc[i] || 0) + ' journal' + (tc[i] === 1 ? '' : 's') + '</span></td></tr>'; }).join('') + '</tbody></table></div>' +
                        '<div class="card"><h3><i class="fa-solid fa-chart-simple"></i> Benford\'s law <small>first digit of every amount; a fabricated population drifts from the line</small></h3><div class="chartbox"><canvas id="jr-ben"></canvas></div></div></div>' +
                        '<div class="card" style="margin-top:12px"><h3><i class="fa-solid fa-ranking-star"></i> Riskiest journals <small>number of tests each one fails, then value</small></h3><div class="scroll" id="jr-top"></div></div>' +
                        '<div class="grid g3" style="margin-top:12px"><div class="card"><h3>By source</h3><div id="jr-src"></div></div><div class="card"><h3>By person</h3><div class="scroll" style="max-height:260px" id="jr-who"></div></div>' +
                        '<div class="card"><h3>Time of posting</h3><div class="chartbox short"><canvas id="jr-h"></canvas></div></div></div>';
                    el.querySelectorAll('#jr-w button').forEach(function (b) { b.onclick = function () { J.win = b.dataset.w; FL.lsSet('jr.win', J.win); FL.render(); }; });
                    el.querySelectorAll('tr[data-t]').forEach(function (tr) { tr.onclick = function () { var t = TESTS[+tr.dataset.t]; FL.drillJournals({ where: base + ' AND ' + t.w, title: t.label }); }; });
                    FL.chart('jr-ben', { data: { labels: ben.rows.map(function (r) { return r.d; }), datasets: [
                        { type: 'bar', label: 'Actual', data: ben.rows.map(function (r) { return r.actual * 100; }), backgroundColor: 'rgba(29,78,216,.7)', borderRadius: 3 },
                        { type: 'line', label: 'Benford', data: ben.rows.map(function (r) { return r.expected * 100; }), borderColor: FL.PAL.bad, pointRadius: 3 }] }, options: { scales: { y: { ticks: { callback: function (v) { return v + '%'; } } } } } });
                    $('jr-top').innerHTML = top.length ? FL.table([{ label: 'Journal', key: 'je_name' }, { label: 'Source', key: 'source' }, { label: 'By', key: 'who' }, { label: 'Date', key: 'acc_date' },
                        { label: 'Amount', n: 1, get: function (r) { return FINE.fmt(r.amount, 'num'); } }, { label: 'Score', n: 1, html: 1, get: function (r) { return '<span class="tag ' + (r.score >= 2 ? 'bad' : 'warn') + '">' + r.score + '</span>'; } }, { label: 'Why', key: 'flags' }], top, { click: true }) : '<div class="callout good">No journal fails a test.</div>';
                    FL.wireRows($('jr-top'), top, function (r) { FL.journal(r.je_id); });
                    $('jr-src').innerHTML = FL.table([{ label: 'Source', key: 'source' }, { label: 'Journals', n: 1, key: 'jes' }, { label: 'Debits', n: 1, get: function (r) { return FL.compact(r.amount); } }], obj(R[3]));
                    $('jr-who').innerHTML = FL.table([{ label: 'Person', key: 'who' }, { label: 'Journals', n: 1, key: 'jes' }, { label: 'Manual', n: 1, key: 'manual' }, { label: 'Debits', n: 1, get: function (r) { return FL.compact(r.amount); } }], obj(R[4]));
                    var hrs = new Array(24).fill(0); R[5].rows.forEach(function (r) { hrs[r[0]] = r[1]; });
                    FL.chart('jr-h', { type: 'bar', data: { labels: hrs.map(function (_, i) { return i + 'h'; }), datasets: [{ label: 'Journals', data: hrs, backgroundColor: hrs.map(function (_, i) { return i >= (+jr.afterHour || 20) || i < (+jr.beforeHour || 7) ? FL.PAL.bad : FL.PAL.act; }), borderRadius: 2 }] }, options: { plugins: { legend: { display: false } } } });
                });
            });
        }
    };

    // ═════════ Close checks ═════════
    FL.TABS.close = {
        render: function (el) {
            var per = FL.filter.period, cfg = FL.config;
            return FL.data().then(function (data) {
                var tm = T(), pi = data._pi, p = pi.list[pi.bySeq[per]], checks = [];
                var add = function (label, status, detail, fn) { checks.push({ label: label, status: status, detail: detail, fn: fn }); };
                var icR = (cfg.intercompany || {}).receivable || '1500', icP = (cfg.intercompany || {}).payable || '2500', contra = cfg.contraAccounts || ['1150', '1650'];
                var plCodes = FL.dims.accounts.filter(FINE.isPl).map(function (a) { return FL.q(a.code); }).join(',') || "''";
                var qs = [
                    "SELECT company, ROUND(SUM(end_bal), 2) AS diff FROM fin_balances WHERE scenario = 'ACTUAL' AND period_seq = " + per + ' GROUP BY 1 ORDER BY 1',
                    'SELECT COUNT(*) FROM (SELECT je_id FROM fin_journals WHERE period_seq = ' + per + ' GROUP BY je_id HAVING ABS(SUM(dr) - SUM(cr)) > 0.01)',
                    "SELECT ROUND(SUM(end_bal) FILTER (WHERE account = " + FL.q(icR) + '), 2), ROUND(SUM(end_bal) FILTER (WHERE account = ' + FL.q(icP) + "), 2) FROM fin_balances WHERE scenario = 'ACTUAL' AND period_seq = " + per,
                    "SELECT ROUND(SUM(dr - cr), 2) FROM fin_journals WHERE je_category = " + FL.q(cfg.icCategory || 'Intercompany') + ' AND account IN (' + plCodes + ') AND period_seq BETWEEN ' + (p.fiscal_year * 100 + 1) + ' AND ' + per,
                    "SELECT b.company, b.account, a.name, a.account_type, ROUND(SUM(b.end_bal), 2) AS bal FROM fin_balances b JOIN fin_accounts a ON a.code = b.account WHERE b.scenario = 'ACTUAL' AND b.period_seq = " + per +
                        " AND a.account_type IN ('A', 'L') AND b.account NOT IN (" + contra.map(FL.q).join(',') + ') GROUP BY ALL HAVING (a.account_type = \'A\' AND SUM(b.end_bal) < -1) OR (a.account_type = \'L\' AND SUM(b.end_bal) > 1) ORDER BY 1, 2',
                    "SELECT COUNT(*) FROM fin_balances WHERE scenario = 'BUDGET' AND period_seq BETWEEN " + (p.fiscal_year * 100 + 1) + ' AND ' + (p.fiscal_year * 100 + 12),
                    "SELECT COUNT(*) FROM fin_balances b JOIN fin_accounts a ON a.code = b.account WHERE b.scenario = 'ACTUAL' AND b.period_seq = " + (p.fiscal_year * 100 + 1) + " AND a.account_type IN ('R', 'E') AND ABS(b.begin_bal) > 0.01",
                    'SELECT COUNT(DISTINCT j.je_id) FROM fin_journals j JOIN fin_periods q ON q.period_seq = j.period_seq WHERE j.period_seq = ' + per + " AND j.posted_at > q.end_date + INTERVAL 5 DAY AND j.je_source IN ('Manual', 'Spreadsheet')"
                ];
                return FL.call('finQueries', { queries: qs }).then(function (res) {
                    var R = res.results;
                    var tb = R[0].rows, bad = tb.filter(function (r) { return Math.abs(r[1]) > 0.01; });
                    add('Trial balance balances for every company', bad.length ? 'bad' : 'ok', bad.length ? bad.map(function (r) { return r[0] + ': ' + FINE.fmt(r[1], 'num', { decimals: 2 }); }).join(', ') : tb.length + ' companies, debits = credits');
                    add('Every journal of the period balances', R[1].rows[0][0] ? 'bad' : 'ok', R[1].rows[0][0] ? R[1].rows[0][0] + ' unbalanced journal(s)' : 'all balanced');
                    if (tm.BS) { var bs = FINE.compute(tm.BS, data, { period: per, scale: 1 }), ch = bs.rows.filter(function (r) { return r.type === 'check'; })[0]; if (ch) add('Balance sheet balances (' + tm.BS.name + ')', ch.ok ? 'ok' : 'bad', ch.ok ? 'assets = equity + liabilities' : 'difference ' + FINE.fmt(ch.raw[0], 'num', { decimals: 2 }) + ' — some accounts are not in the template'); }
                    if (tm.CF) { var cf = FINE.compute(tm.CF, data, { period: per, scale: 1 }), cc = cf.rows.filter(function (r) { return r.type === 'check'; })[0]; if (cc) add('Cash flow ties to the bank balance', cc.ok ? 'ok' : 'bad', cc.ok ? 'closing cash = balance sheet cash' : 'difference ' + FINE.fmt(cc.raw[0], 'num', { decimals: 2 }) + ' — an account is missing from the cash flow template'); }
                    if (tm.BS) { var s = FINE.compute(tm.BS, data, { period: per, scale: 1 }).rows.filter(function (r) { return r.id === 'SUSP'; })[0]; if (s) add('Suspense / unallocated cleared', Math.abs(s.raw[0]) > 0.5 ? 'bad' : 'ok', Math.abs(s.raw[0]) > 0.5 ? 'balance ' + FINE.fmt(s.raw[0], 'num', { decimals: 2 }) : 'nil', function () { FL.drillJournals({ where: "j.account IN (SELECT code FROM fin_accounts WHERE class = 'Suspense') AND j.period_seq <= " + per, title: 'Suspense postings' }); }); }
                    var ic = R[2].rows[0] || [0, 0], icd = (ic[0] || 0) + (ic[1] || 0);
                    add('Intercompany balances agree (' + icR + ' vs ' + icP + ')', Math.abs(icd) > 1 ? 'bad' : 'ok', 'receivable ' + FINE.fmt(ic[0] || 0, 'num', { zero: 'nil' }) + ', payable ' + FINE.fmt(-(ic[1] || 0), 'num', { zero: 'nil' }) + (Math.abs(icd) > 1 ? ' — difference ' + FINE.fmt(icd, 'num') : ''));
                    var icp = R[3].rows[0][0] || 0;
                    add('Intercompany income = intercompany expense (YTD)', Math.abs(icp) > 1 ? 'bad' : 'ok', Math.abs(icp) > 1 ? 'income and expense differ by ' + FINE.fmt(Math.abs(icp), 'num') + ' — one side booked a different amount' : 'they eliminate', function () { FL.drillJournals({ where: 'j.je_category = ' + FL.q(cfg.icCategory || 'Intercompany') + ' AND j.account IN (' + plCodes + ') AND j.period_seq BETWEEN ' + (p.fiscal_year * 100 + 1) + ' AND ' + per, title: 'Intercompany income and expense' }); });
                    var ab = R[4].rows;
                    add('No asset with a credit balance / liability with a debit balance', ab.length ? 'warn' : 'ok', ab.length ? ab.slice(0, 4).map(function (r) { return r[0] + ' ' + r[1] + ' ' + r[2] + ' ' + FINE.fmt(r[4], 'num'); }).join('; ') : 'all balances on their natural side');
                    add('Budget loaded for ' + p.fiscal_year, R[5].rows[0][0] ? 'ok' : 'warn', R[5].rows[0][0] ? R[5].rows[0][0].toLocaleString() + ' budget balances' : 'no budget: budget columns show zero');
                    add('Income statement accounts start the year at nil', R[6].rows[0][0] ? 'bad' : 'ok', R[6].rows[0][0] ? R[6].rows[0][0] + ' account(s) carried a balance into the new year' : 'year-end roll-over is clean');
                    add('Manual journals posted after the close', R[7].rows[0][0] ? 'warn' : 'ok', R[7].rows[0][0] ? R[7].rows[0][0] + ' manual journal(s) posted more than 5 days after the period end' : 'none');
                    var an = FINE.anomalies(data, per, { z: 3.5 });
                    add('Unusual account movements reviewed', an.length ? 'warn' : 'ok', an.length ? an.length + ' account(s) far from their usual level: ' + an.slice(0, 3).map(function (a) { return a.code + ' ' + a.name; }).join(', ') : 'nothing unusual', function () { FL.an.view = 'anom'; FL.show('analytics'); });
                    var okN = checks.filter(function (c) { return c.status === 'ok'; }).length;
                    el.innerHTML = '<div class="row" style="margin-bottom:10px"><h2 style="margin:0;font-size:1.05rem">Close checks · ' + esc(p.period_name) + '</h2><span class="muted sm">all companies</span><span class="grow"></span>' +
                        '<span class="tag ' + (okN === checks.length ? 'good' : 'warn') + '">' + okN + ' / ' + checks.length + ' passed</span></div><div class="card" style="padding:0">' +
                        checks.map(function (c, i) {
                            return '<div class="chk"><i class="ic fa-solid ' + (c.status === 'ok' ? 'fa-circle-check ok' : c.status === 'bad' ? 'fa-circle-xmark bad' : 'fa-triangle-exclamation warn') + '"></i><div><b>' + esc(c.label) + '</b><div class="sm muted">' + esc(c.detail) + '</div></div>' +
                                (c.fn ? '<button class="btn sm" data-c="' + i + '">Look</button>' : '<span></span>') + '</div>';
                        }).join('') + '</div>';
                    el.querySelectorAll('[data-c]').forEach(function (b) { b.onclick = function () { checks[+b.dataset.c].fn(); }; });
                });
            });
        }
    };

    // ═════════ Data ═════════
    FL.TABS.data = {
        render: function (el) {
            var st = FL.status || {}, m = st.meta || {}, c = st.counts || {}, admin = FL.who && FL.who.admin;
            el.innerHTML = '<div class="grid g2"><div class="card"><h3><i class="fa-solid fa-database"></i> Finance data on this PC</h3>' +
                (st.loaded ? '<table class="t"><tbody>' + [['Source', m.source], ['Loaded', m.loaded_at], ['Description', m.description], ['Periods', (c.first_period || '') + ' – ' + (c.last_period || '')],
                    ['Companies · cost centres · accounts', (c.companies || 0) + ' · ' + (c.cost_centres || 0) + ' · ' + (c.accounts || 0)], ['Balances', (c.balances || 0).toLocaleString()], ['Journal lines', (c.journals || 0).toLocaleString()],
                    ['File', st.root + ' (' + st.sizeMb + ' MB)']].map(function (r) { return '<tr><td class="muted">' + esc(r[0]) + '</td><td>' + esc(r[1] == null ? '' : r[1]) + '</td></tr>'; }).join('') + '</tbody></table>'
                    : '<p>No data yet.</p>') +
                '<div class="row" style="margin-top:10px">' + (admin ? '<button class="btn" onclick="FL.loadSample()"><i class="fa-solid fa-flask"></i> Load sample data</button>' +
                    '<button class="btn" id="d-root"><i class="fa-regular fa-folder"></i> Folder…</button>' : '<span class="sm muted">An AI admin loads data and sets the folder.</span>') +
                '<button class="btn" onclick="FL.refresh()"><i class="fa-solid fa-rotate"></i> Reload</button></div></div>' +
                '<div class="card" id="fus-card"></div></div>' +
                (st.loaded ? '<div class="card" id="map-card" style="margin-top:12px"></div>' : '') +
                (st.loaded ? '<div class="card" style="margin-top:12px"><h3><i class="fa-solid fa-terminal"></i> SQL explorer <small>read-only DuckDB SQL over fin_balances, fin_journals, fin_accounts, fin_periods, fin_companies, fin_cost_centres</small></h3>' +
                    '<div class="row" style="margin-bottom:6px">' + [['Trial balance', "SELECT b.account, a.name, a.account_type, ROUND(SUM(b.end_bal), 2) AS balance FROM fin_balances b JOIN fin_accounts a ON a.code = b.account WHERE b.scenario = 'ACTUAL' AND b.period_seq = " + FL.filter.period + ' GROUP BY ALL ORDER BY 1'],
                        ['Revenue by month', "SELECT period_name, period_seq, -SUM(period_net) AS revenue FROM fin_balances WHERE scenario = 'ACTUAL' AND account LIKE '4%' GROUP BY ALL ORDER BY period_seq"],
                        ['Manual journals', "SELECT je_name, created_by, CAST(accounting_date AS VARCHAR) AS date, SUM(dr) AS amount FROM fin_journals WHERE je_source = 'Manual' GROUP BY ALL ORDER BY amount DESC LIMIT 100"],
                        ['Budget vs actual by account', "SELECT account, SUM(period_net) FILTER (WHERE scenario = 'ACTUAL') AS actual, SUM(period_net) FILTER (WHERE scenario = 'BUDGET') AS budget FROM fin_balances WHERE account >= '4' GROUP BY 1 ORDER BY 1"]]
                        .map(function (x, i) { return '<button class="btn sm" data-q="' + i + '">' + esc(x[0]) + '</button>'; }).join('') + '</div>' +
                    '<textarea class="sql" id="d-sql">' + esc(FL.ls('sql', "SELECT company, account, ROUND(SUM(end_bal), 2) AS balance FROM fin_balances WHERE scenario = 'ACTUAL' AND period_seq = " + FL.filter.period + ' GROUP BY ALL ORDER BY 1, 2')) + '</textarea>' +
                    '<div class="row" style="margin:6px 0"><button class="btn primary sm" id="d-run"><i class="fa-solid fa-play"></i> Run (Ctrl+Enter)</button><button class="btn sm" id="d-csv"><i class="fa-solid fa-file-csv"></i> CSV</button><span class="sm muted" id="d-info"></span></div><div class="scroll" id="d-res"></div></div>' +
                    '<div class="card" style="margin-top:12px"><h3><i class="fa-solid fa-sitemap"></i> Chart of accounts <small>' + FL.dims.accounts.length + ' accounts</small></h3><div class="scroll" style="max-height:300px">' +
                    FL.table([{ label: 'Account', key: 'code' }, { label: 'Name', key: 'name' }, { label: 'Type', get: function (a) { return { A: 'Asset', L: 'Liability', O: 'Equity', R: 'Revenue', E: 'Expense' }[a.account_type] || a.account_type; } }, { label: 'Class', key: 'class' }], FL.dims.accounts) + '</div></div>' : '');
            if ($('d-root')) $('d-root').onclick = function () {
                var r = prompt('Folder for the finance data (DuckDB file, templates.json, config.json):', st.root || 'C:\\fusion\\finance');
                if (r) FL.call('finSetRoot', { root: r }).then(function () { FL.toast('Folder set', 'ok'); FL.refresh(); }).catch(function (e) { FL.toast(String(e), 'err'); });
            };
            FL.fusion.render($('fus-card'));
            if ($('map-card')) FL.mapping.render($('map-card'));
            if (!st.loaded) return;
            var QS = el.querySelectorAll('[data-q]');
            var samples = [["SELECT b.account, a.name, a.account_type, ROUND(SUM(b.end_bal), 2) AS balance FROM fin_balances b JOIN fin_accounts a ON a.code = b.account WHERE b.scenario = 'ACTUAL' AND b.period_seq = " + FL.filter.period + ' GROUP BY ALL ORDER BY 1'],
                ["SELECT period_name, period_seq, -SUM(period_net) AS revenue FROM fin_balances WHERE scenario = 'ACTUAL' AND account LIKE '4%' GROUP BY ALL ORDER BY period_seq"],
                ["SELECT je_name, created_by, CAST(accounting_date AS VARCHAR) AS date, SUM(dr) AS amount FROM fin_journals WHERE je_source = 'Manual' GROUP BY ALL ORDER BY amount DESC LIMIT 100"],
                ["SELECT account, SUM(period_net) FILTER (WHERE scenario = 'ACTUAL') AS actual, SUM(period_net) FILTER (WHERE scenario = 'BUDGET') AS budget FROM fin_balances WHERE account >= '4' GROUP BY 1 ORDER BY 1"]];
            QS.forEach(function (b, i) { b.onclick = function () { $('d-sql').value = samples[i][0]; run(); }; });
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
            $('d-run').onclick = run;
            $('d-sql').onkeydown = function (e) { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); run(); } };
            $('d-csv').onclick = function () { if (last) FL.csv('query.csv', last.columns, last.rows); };
        }
    };
})();
