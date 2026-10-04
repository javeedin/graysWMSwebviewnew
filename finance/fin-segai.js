/* Finance Lens — Segment P&L › AI Agent (view `ai` of FL.segpl): one-click "missions" a CFO or a CIO / controller would give an
   analyst, run by the CFO Copilot (finAsk: Claude with run_sql over this PC's DuckDB, audited, kill switch) on the segment P&L in
   front of them. Each mission sends the segment table (every value's revenue, cost of sales, gross profit, opex, EBITDA, net profit,
   comparison) + the rule findings + how to query fin_gl_ext_v for more, and asks for a specific deliverable (briefing, who to talk
   to, margin recovery, cost allocation, outlook, board text, scorecards, deep dive on one value; data quality, unusual postings,
   reconciliation & coverage, what to automate). Results are cards with the live steps, Markdown + charts, cost, Copy / Save .md /
   follow-up, kept per PC (localStorage finlens.segai). */
(function () {
    var G = FL.segpl; if (!G) return;
    var A = G.ai = { busy: false, hist: FL.ls('segai', []), live: null, charts: [] };
    var esc = window.esc;
    var strip = function (h) { return String(h || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'); };
    var R = function (v) { return v == null ? null : Math.round(v); };

    A.MISSIONS = [
        { id: 'brief', who: 'cfo', icon: 'fa-file-lines', title: 'Executive briefing', sub: 'one page: headline, what is going well, risks, decisions',
          ask: 'Write a one-page executive briefing on the P&L by {SEG} for {PERIODS}{CMP}. Structure: a one-sentence headline with the key number; "Going well" (3 bullets); "Risks" (3 bullets); "Decisions needed" (3 bullets, each with the money at stake). Use the figures given; query fin_gl_ext_v only to confirm something surprising.' },
        { id: 'actions', who: 'cfo', icon: 'fa-user-check', title: 'Who to talk to this week', sub: 'the 5 conversations worth the most money',
          ask: 'Pick the 5 {SEG} values the CFO should talk to (or about) this week. For each: who, the issue in one line, the money at stake (be explicit how you computed it), the question to ask them, and what good looks like next month. End with a table: {SEG} · issue · money at stake · owner action.' },
        { id: 'margin', who: 'cfo', icon: 'fa-percent', title: 'Margin recovery plan', sub: 'who sells below the median margin and what it costs',
          ask: 'Build a margin recovery plan. Find the {SEG} values selling below the median gross margin (ignore blank / default values). For each: revenue, margin, gap in points, gross profit recoverable at the median margin. Query fin_gl_ext_v (grouped by account) for the 3 biggest of them to see whether the gap comes from discounts / returns accounts, cost of sales, or mix. Finish with a table and a total "recoverable gross profit" and 3 concrete levers.' },
        { id: 'alloc', who: 'cfo', icon: 'fa-scale-balanced', title: 'Fair cost allocation', sub: 'spread costs sitting on blank / default values',
          ask: 'Costs parked on blank / default {SEG} values make every other value look more profitable. Propose a fair allocation: (1) list what sits there (opex by line); (2) offer two drivers — revenue share and gross-profit share — and say which fits which cost line; (3) show a table per {SEG} value: EBITDA before, allocated cost, EBITDA after, and flag who turns loss-making. Totals must still tie to the company EBITDA.' },
        { id: 'forecast', who: 'cfo', icon: 'fa-chart-line', title: 'Run-rate & outlook', sub: 'where the next period lands at the current pace',
          ask: 'Query fin_gl_ext_v by period_seq for the synced periods (revenue = income accounts, sign income +) for the top 15 {SEG} values and the total. Give the monthly run-rate, the trend (growing / flat / falling) per value, a simple outlook for the next period with a range, and the 3 values whose trend changes the picture most. Include one ```chart block (line, total revenue by period).' },
        { id: 'board', who: 'cfo', icon: 'fa-landmark', title: 'Board pack text', sub: 'paste-ready paragraph + table',
          ask: 'Write the board-pack section "Performance by {SEG}" for {PERIODS}{CMP}: a 120-word narrative in a calm, factual board tone, then a table of the top 10 values (revenue, gross margin %, EBITDA, change), then 2 sentences on actions taken / proposed. No jargon, no internal codes without their names.' },
        { id: 'score', who: 'cfo', icon: 'fa-ranking-star', title: 'Scorecards A / B / C', sub: 'tier every value on growth, margin and profit',
          ask: 'Score every {SEG} value with revenue: tier A (above-median margin and positive EBITDA and, if there is a comparison, growing), C (loss-making or margin 10+ pts below median), B the rest. Give the rule you used, the count and revenue share per tier, and a table of tier C with the reason for each.' },
        { id: 'deep', who: 'cfo', icon: 'fa-crosshairs', title: 'Deep dive on one value', sub: 'pick a value below, or Segment P&amp;L › KPIs › Focus on', focus: true,
          ask: 'Deep dive on {SEG} {FOCUS}. Compare it with its peers (the median value) and with the comparison period: revenue, margin, opex, EBITDA. Query fin_gl_ext_v WHERE {SEGCOL} = \'{FOCUSCODE}\' grouped by account and by period_seq to find what drives its result. Give: the 3 facts that matter, the accounts behind them, what to ask the person responsible, and a recommendation.' },
        { id: 'dq', who: 'cio', icon: 'fa-broom', title: 'Data quality audit', sub: 'unassigned postings, missing cost of sales, blanks, names',
          ask: 'Audit the data quality of the {SEG} segment as a controller / CIO would. Check with run_sql on fin_gl_ext_v: share of revenue and opex on blank or default values (e.g. all-zero codes); values with revenue but no cost of sales; accounts that post to many values vs only to the default; values without a name in fin_segment_values. For each finding: size, likely root cause in Oracle Fusion (default segment values, subledger accounting rules, cross-validation rules, missing derivation from the customer / salesperson) and the fix. End with a prioritised fix list.' },
        { id: 'controls', who: 'cio', icon: 'fa-shield-halved', title: 'Unusual postings', sub: 'wrong-sign balances, jumps, round amounts',
          ask: 'Look for unusual postings in fin_gl_ext_v for the chosen periods and {SEG}: income accounts with a debit (negative) result per value, cost accounts with a credit result, values whose amount on an account jumped more than 3× versus the comparison, and suspiciously round amounts. List the top 15 with value, account, amount and why it is unusual, and say which ones to send to the controller.' },
        { id: 'recon', who: 'cio', icon: 'fa-check-double', title: 'Reconciliation & coverage', sub: 'does the segment view tie to the trial balance?',
          ask: 'Check that the {SEG} view can be trusted: for each chosen period and company compare SUM(dr), SUM(cr) and opening per account between fin_gl_balances_acct (trial balance, translated_flag <> \'R\') and fin_gl_ext_v; list the accounts that differ and by how much; say which periods / companies are not synced (fin_tb_periods, fin_gl_balances_ext_sync). Conclude with a clear "safe to report / not yet" and what to re-sync.' },
        { id: 'automate', who: 'cio', icon: 'fa-gears', title: 'What to automate', sub: 'alerts, monthly pack, controls to set up',
          ask: 'Based on this {SEG} P&L, propose what to automate: 5 monitoring rules (metric, threshold, who gets alerted, how often — e.g. a value’s margin below X%, opex on default values above Y%), a monthly pack (sections, recipients, timing) and 3 data controls to set up in Oracle Fusion so the segment is always filled. Keep each item one line, practical, with the threshold justified by the current numbers.' }
    ];

    /** What the AI gets: the segment table, the rule findings and how to query for more */
    A.context = function () {
        var s = G.st, d = G.kpi.build(), f = d.f, L = G.led || {};
        var ps = d.ps, segcol = f === 'company' ? 'company' : f;
        return {
            purpose: 'Segment P&L — the income statement split by one segment of the chart of accounts',
            segment: { name: G.label(f), column: segcol, ledger: L.name, currency: L.currency, ledger_id: L.ledger_id },
            periods: ps.map(G.pname), period_seqs: ps, compare_with: s.cmp === 'none' ? null : (s.cmp === 'py' ? 'same period last year' : 'previous period(s)'),
            compare_periods: (G.plan && G.plan.seqs || []).map(G.pname), companies: s.cos.length ? s.cos : 'all', filters: s.filters,
            units: 'currency units (not scaled); income and profit positive, costs as positive cost lines in opex / cogs',
            totals: { now: d.tot, comparison: d.ctot },
            values: d.list.slice(0, 80).map(function (x) {
                var o = { code: x.v, name: x.label, unassigned: x.un || undefined, revenue: R(x.m.rev), cogs: R(x.m.cogs), gross_profit: R(x.m.gp), gross_margin_pct: x.m.gpm == null ? null : Math.round(x.m.gpm * 10) / 10, opex: R(x.m.opex), ebitda: R(x.m.ebitda), net_profit: R(x.m.np) };
                if (x.c) o.comparison = { revenue: R(x.c.rev), gross_profit: R(x.c.gp), opex: R(x.c.opex), ebitda: R(x.c.ebitda) };
                return o;
            }),
            values_total: d.list.length,
            findings: G.kpi.insights(d).map(function (i) { return strip(i.t); }),
            how_to_query: 'run_sql on DuckDB view fin_gl_ext_v (ledger_id, period_seq, period_name, adj, company, account, account_type, segment1..segment30, opening, dr, cr, closing). ' +
                'Filter: ledger_id = ' + (+L.ledger_id) + ' AND period_seq IN (' + ps.join(',') + ')' + (s.cos.length ? " AND company IN ('" + s.cos.join("','") + "')" : '') + '. The ' + G.label(f) + ' is column ' + segcol + '. ' +
                'P&L effect of a row = cr - dr (income +, costs -). Account names: fin_accounts (code, name, account_type R/E/A/L/O, class); segment value names: fin_segment_values (column_name, value, description). ' +
                'Trial balance: fin_gl_balances_acct (period_name, company, account, begin_balance_dr/cr, period_net_dr/cr, translated_flag); periods: fin_tb_periods (period_name, period_seq, adj).'
        };
    };
    A.prompt = function (m) {
        var s = G.st, d = G.kpi.build(), seg = G.label(d.f), fx = s.aiFocus != null ? d.list.filter(function (x) { return x.v === s.aiFocus; })[0] : null;
        return m.ask.replace(/\{SEG\}/g, seg).replace(/\{PERIODS\}/g, d.ps.map(G.pname).join(', '))
            .replace(/\{CMP\}/g, s.cmp === 'none' ? '' : ' compared with ' + (s.cmp === 'py' ? 'the same period last year' : 'the previous period(s)'))
            .replace(/\{FOCUS\}/g, fx ? fx.label : '(none chosen)').replace(/\{FOCUSCODE\}/g, fx ? String(fx.v).replace(/'/g, "''") : '').replace(/\{SEGCOL\}/g, d.f === 'company' ? 'company' : d.f) +
            '\n\nUse the segment data in the context first (it is already computed from the statement template). Show money in the ledger currency with thousands separators. Be specific: names, numbers, what to do.';
    };

    A.save = function () { FL.lsSet('segai', A.hist.slice(0, 15).map(function (h) { return Object.assign({}, h, { md: String(h.md || '').slice(0, 40000), steps: (h.steps || []).slice(-30) }); })); };
    A.run = function (id, question) {
        var s = G.st;
        if (A.busy) { FL.toast('The agent is still working on "' + A.busy + '" — wait or press Stop', 'info'); return; }
        if (!s.groups.length) { FL.toast('Add a segment on the left first (e.g. Salesperson)', 'err'); return; }
        var m = id === 'ask' ? { id: 'ask', title: 'Your question', ask: question } : A.MISSIONS.filter(function (x) { return x.id === id; })[0]; if (!m) return;
        if (m.focus && s.aiFocus == null) { FL.toast('Pick the value first (the box under the missions, or Segment P&L › KPIs › Focus on)', 'err'); return; }
        var d = G.kpi.build(), fx = s.aiFocus != null ? d.list.filter(function (x) { return x.v === s.aiFocus; })[0] : null;
        var q = id === 'ask' ? question + '\n\n(Context: the P&L by ' + G.label(d.f) + ' for ' + d.ps.map(G.pname).join(', ') + '.)' : A.prompt(m);
        var h = { id: 'r' + Date.now(), mission: m.id, title: m.title + (m.focus && fx ? ' — ' + fx.label : ''), at: new Date().toISOString(), seg: G.label(d.f), periods: d.ps.map(G.pname).join(', '), q: q, md: '', steps: [], pending: true };
        A.hist.unshift(h); A.busy = m.title; A.paint();
        FL.call('finAsk', { question: q, history: [], context: JSON.stringify(A.context()) }, 11 * 60000, function (msg) {
            if (!msg || /^(Reading the numbers|Checking the ledger|Writing the answer)/.test(msg)) return;
            h.steps.push(msg); A.paintLive(h);
        }).then(function (r) { h.md = r.answer || '(no answer)'; h.steps = r.steps || h.steps; h.cost = r.costUsd; })
          .catch(function (e) { h.error = String(e && e.message || e); })
          .then(function () { h.pending = false; A.busy = false; A.save(); A.paint(); });
    };

    A.drawCharts = function (root) {
        A.charts.forEach(function (c) { try { c.destroy(); } catch (e) { /* gone */ } }); A.charts = [];
        root.querySelectorAll('canvas[data-chart]').forEach(function (cv) {
            try {
                var spec = JSON.parse(decodeURIComponent(cv.dataset.chart)), pal = FL.PAL.series;
                var type = { bar: 'bar', line: 'line', pie: 'doughnut', doughnut: 'doughnut', column: 'bar' }[spec.type] || 'bar';
                A.charts.push(new Chart(cv, { type: type, data: { labels: spec.labels || [], datasets: (spec.datasets || []).slice(0, 6).map(function (ds, k) {
                    return { label: ds.label, data: ds.data, backgroundColor: type === 'doughnut' ? pal : pal[k % pal.length], borderColor: pal[k % pal.length], borderWidth: type === 'line' ? 2 : 0, tension: 0.25, pointRadius: type === 'line' ? 2 : 0, borderRadius: 3 }; }) },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { title: { display: !!spec.title, text: spec.title }, legend: { labels: { boxWidth: 10, font: { size: 10 } } } },
                        scales: type === 'doughnut' ? {} : { y: { ticks: { callback: function (v) { return FL.compact(v); }, font: { size: 10 } } }, x: { ticks: { font: { size: 10 } } } } } }));
            } catch (e) { cv.parentNode.innerHTML = '<span class="sm muted">chart could not be drawn</span>'; }
        });
    };
    A.card = function (h, i) {
        return '<div class="card sa-res" data-h="' + h.id + '"><div class="row" style="gap:8px;flex-wrap:wrap"><b>' + esc(h.title) + '</b><span class="muted sm">' + esc(h.seg + ' · ' + h.periods + ' · ' + String(h.at).slice(0, 16).replace('T', ' ')) + '</span><span class="grow"></span>' +
            (h.pending ? '<span class="sm"><i class="fa-solid fa-circle-notch fa-spin"></i> working…</span> <button class="btn sm" data-stop="1"><i class="fa-solid fa-stop"></i> Stop</button>'
                : (h.cost != null ? '<span class="muted sm">$' + h.cost.toFixed(3) + '</span>' : '') +
                  '<button class="btn sm ghost" data-a="copy" title="Copy the answer"><i class="fa-solid fa-copy"></i></button><button class="btn sm ghost" data-a="md" title="Save as .md"><i class="fa-solid fa-download"></i></button>' +
                  '<button class="btn sm ghost" data-a="follow" title="Ask a follow-up in the Copilot"><i class="fa-solid fa-comments"></i></button><button class="btn sm ghost" data-a="rerun" title="Run again"><i class="fa-solid fa-rotate"></i></button><button class="btn sm ghost" data-a="del" title="Remove"><i class="fa-solid fa-trash"></i></button>') + '</div>' +
            (h.steps && h.steps.length ? '<details class="sa-steps"' + (h.pending ? ' open' : '') + '><summary class="sm muted">' + h.steps.length + ' step(s) — what the agent looked at</summary><div class="sm sa-live">' + h.steps.slice(-30).map(function (x) { return '<div>• ' + esc(x) + '</div>'; }).join('') + '</div></details>' : '') +
            (h.error ? '<div class="callout bad sm">' + esc(h.error) + '</div>' : '') + (h.md ? '<div class="cop-md sa-md">' + FL.copilot.md(h.md, 700 + i) + '</div>' : '') + '</div>';
    };
    A.paintLive = function (h) {
        var c = document.querySelector('.sa-res[data-h="' + h.id + '"] .sa-live');
        if (c) c.innerHTML = h.steps.slice(-30).map(function (x) { return '<div>• ' + esc(x) + '</div>'; }).join(''); else A.paint();
    };
    A.paint = function () { var el = $('sa-results'); if (!el) return; el.innerHTML = A.hist.length ? A.hist.map(A.card).join('') : '<div class="empty sm">Pick a mission — the answer appears here, newest first, and is kept on this PC.</div>'; A.drawCharts(el); A.wireResults(el); A.paintBusy(); };
    A.paintBusy = function () { document.querySelectorAll('.sa-m').forEach(function (b) { b.disabled = !!A.busy; }); if ($('sa-go')) $('sa-go').disabled = !!A.busy; };
    A.wireResults = function (el) {
        el.querySelectorAll('[data-stop]').forEach(function (b) { b.onclick = function () { FL.call('finAskCancel', {}).catch(function () { /* ended */ }); b.disabled = true; }; });
        el.querySelectorAll('[data-a]').forEach(function (b) {
            b.onclick = function () {
                var h = A.hist.filter(function (x) { return x.id === b.closest('.sa-res').dataset.h; })[0]; if (!h) return;
                var a = b.dataset.a;
                if (a === 'copy') { navigator.clipboard.writeText(h.md || '').then(function () { FL.toast('Copied', 'ok'); }); }
                else if (a === 'md') FL.download(h.title.replace(/[^\w -]+/g, '').replace(/\s+/g, '-').toLowerCase() + '.md', new Blob(['# ' + h.title + '\n\n_' + h.seg + ' · ' + h.periods + '_\n\n' + (h.md || '')], { type: 'text/markdown' }));
                else if (a === 'follow') { var C = FL.copilot; C.msgs.push({ role: 'user', content: h.q }); C.msgs.push({ role: 'assistant', content: h.md, steps: h.steps }); C.save(); C.show(); }
                else if (a === 'rerun') A.run(h.mission, h.mission === 'ask' ? h.q : null);
                else if (a === 'del') { A.hist = A.hist.filter(function (x) { return x !== h; }); A.save(); A.paint(); }
            };
        });
    };

    G.viewAi = function (out) {
        var s = G.st;
        if (!s.groups.length) { out.innerHTML = '<div class="card sp-card"><p>Add a segment on the left (e.g. <b>Salesperson</b>) — the agent works on the P&amp;L by that segment.</p></div>'; G.out = null; return; }
        var d = G.kpi.build(), seg = G.label(d.f), ins = G.kpi.insights(d).slice(0, 3), fx = s.aiFocus != null ? d.list.filter(function (x) { return x.v === s.aiFocus; })[0] : null;
        var group = function (who, title, sub) {
            return '<div class="sa-grp"><h3>' + title + ' <span class="muted sm">' + sub + '</span></h3><div class="sa-grid">' + A.MISSIONS.filter(function (m) { return m.who === who; }).map(function (m) {
                return '<button class="sa-m" data-m="' + m.id + '"' + (A.busy ? ' disabled' : '') + '><i class="fa-solid ' + m.icon + '"></i><b>' + esc(m.title) + '</b><span>' + esc(m.sub) + '</span></button>'; }).join('') + '</div></div>';
        };
        out.innerHTML = '<div class="sa-wrap">' +
            '<div class="card sa-head"><div class="row" style="gap:10px;flex-wrap:wrap"><h3 style="margin:0"><i class="fa-solid fa-robot"></i> AI Agent · ' + esc(seg) + '</h3><span class="muted sm">' + esc(d.ps.map(G.pname).join(', ')) + (s.cmp !== 'none' ? ' vs ' + (s.cmp === 'py' ? 'last year' : 'previous') : '') + ' · ' + d.list.length + ' values · the agent can read every balance on this PC (read-only)</span></div>' +
            (ins.length ? '<ul class="sk-ins" style="margin-top:8px">' + ins.map(function (i) { return '<li class="' + i.k + '"><span class="sk-ic">' + (i.k === 'good' ? '▲' : i.k === 'bad' ? '!' : 'i') + '</span><span>' + i.t + '</span></li>'; }).join('') + '</ul>' : '') + '</div>' +
            group('cfo', 'For the CFO', 'decisions, money at stake, what to say to whom') +
            group('cio', 'For the CIO & controllers', 'can the numbers be trusted, what to fix and automate') +
            '<div class="card sa-ask"><div class="row" style="gap:8px;flex-wrap:wrap"><label class="sm"><i class="fa-solid fa-crosshairs"></i> Deep-dive value <input id="sa-fq" list="sa-fl" placeholder="type a ' + esc(seg.toLowerCase()) + '…" value="' + esc(fx ? fx.label : '') + '" autocomplete="off"></label>' +
            '<datalist id="sa-fl">' + d.list.map(function (x) { return '<option value="' + esc(x.label) + '">'; }).join('') + '</datalist>' +
            '<input id="sa-q" placeholder="Or ask anything about the P&L by ' + esc(seg.toLowerCase()) + ' — e.g. why did EBITDA fall for the top 3?" style="flex:1;min-width:280px">' +
            '<button class="btn primary" id="sa-go"' + (A.busy ? ' disabled' : '') + '><i class="fa-solid fa-paper-plane"></i> Ask</button></div></div>' +
            '<div id="sa-results"></div></div>';
        out.querySelectorAll('.sa-m').forEach(function (b) { b.onclick = function () { A.run(b.dataset.m); }; });
        var setF = function () { var t = String($('sa-fq').value || '').trim().toLowerCase(); var m = d.list.filter(function (x) { return x.label.toLowerCase() === t; })[0] || d.list.filter(function (x) { return t && (x.v.toLowerCase() === t || x.label.toLowerCase().indexOf(t) >= 0); })[0];
            s.aiFocus = m ? m.v : null; G.kpi.save(); };
        $('sa-fq').onchange = setF;
        $('sa-go').onclick = function () { var q = $('sa-q').value.trim(); if (q) { A.run('ask', q); $('sa-q').value = ''; } };
        $('sa-q').onkeydown = function (e) { if (e.key === 'Enter') $('sa-go').click(); };
        G.out = null;
        A.paint();
    };
})();
