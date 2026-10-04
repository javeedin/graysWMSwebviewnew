/* Finance Lens — CFO Copilot: a drawer where the CFO asks questions in plain words. The host (classes/FinanceAskAgent.cs,
   finAsk / finAskCancel, progress finProgress) runs Claude with read-only tools over the DuckDB data; the page sends what
   is on the screen (filter, statements, KPIs, monitors) so the answer matches the numbers shown. Answers are Markdown with
   one optional ```chart block and links that drill: acct:CODE, je:ID, cc:CODE, period:SEQ, ask:question. */
(function () {
    var C = FL.copilot = { open: false, busy: false, msgs: FL.ls('copilot', []), charts: [] };

    C.SUGGEST = [
        'Why is net profit different from budget this month?',
        'What drove the change in gross margin compared with last year?',
        'Which cost centres are over budget year to date, and on which accounts?',
        'Show revenue by month for the last 12 months against budget as a chart',
        'Explain the movement in cash this month',
        'What are the five biggest expense increases versus last year?',
        'Are there unusual or risky journals this month?',
        'Give me a three-line summary for the board',
        'Run the month-end close for this period',
        'Write the variance commentary for this month',
        'Build the roll-forward of trade receivables'
    ];

    C.toggle = function () { C.open ? C.close() : C.show(); };
    C.show = function () {
        if (!$('cop')) {
            document.body.insertAdjacentHTML('beforeend', '<aside class="cop" id="cop"><div class="cop-h"><i class="fa-solid fa-wand-magic-sparkles"></i><div><b>CFO Copilot</b><div class="sm" id="cop-ctx"></div></div><span class="grow"></span>' +
                '<button class="icon" id="cop-clear" title="New conversation"><i class="fa-regular fa-square-plus"></i></button><button class="icon" id="cop-x" title="Close"><i class="fa-solid fa-xmark"></i></button></div>' +
                '<div class="cop-b" id="cop-b"></div><details class="cop-sugbar" id="cop-sugbar" open><summary class="sm"></summary><div class="cop-sugs" id="cop-sugs"></div></details><div class="cop-f"><textarea id="cop-q" rows="2" placeholder="Ask about revenue, margins, budget, cash, cost centres, journals… (Enter to send)"></textarea>' +
                '<button class="btn primary" id="cop-send" title="Send"><i class="fa-solid fa-paper-plane"></i></button></div></aside>');
            $('cop-x').onclick = C.close;
            $('cop-clear').onclick = function () { if (C.busy) return; C.msgs = []; C.save(); C.paint(); };
            $('cop-send').onclick = function () { if (C.busy) FL.call('finAskCancel'); else C.ask($('cop-q').value); };
            $('cop-q').onkeydown = function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!C.busy) C.ask(this.value); } };
            $('cop-b').addEventListener('click', C.onLink);
        }
        C.open = true; $('cop').classList.add('open'); document.body.classList.add('cop-on');
        $('cop-ctx').textContent = FL.status && FL.status.loaded ? FL.filterText() + ' · ' + FL.periodName(FL.filter.period) : 'no data loaded';
        C.paintSuggest();
        C.paint();
        setTimeout(function () { $('cop-q').focus(); }, 50);
    };
    /** Prompts that fit the page on screen — a click puts the prompt in the box (edit it, Enter sends); nothing runs by itself */
    C.pagePrompts = function () {
        var G = FL.segpl, tab = FL.tab;
        if ((tab === 'segpl' || tab === 'segai') && G && G.st && G.st.groups && G.st.groups.length) {
            var seg = G.label(G.st.groups[0]), sl = seg.toLowerCase(), fx = null;
            try { var d = G.kpi.build(); fx = G.st.kpiFocus != null ? d.list.filter(function (x) { return x.v === G.st.kpiFocus; })[0] : null; } catch (e) { /* no data yet */ }
            var cmp = G.st.cmp === 'py' ? 'last year' : G.st.cmp === 'prev' ? 'the previous period' : null;
            return { title: 'Segment P&L by ' + seg, items: [].concat(fx ? ['Deep dive on ' + fx.label + ': what drives its result, compared with its peers' + (cmp ? ' and ' + cmp : '') + '?', 'Which accounts explain the margin of ' + fx.label + '?'] : [], [
                'Which 5 ' + sl + ' values should I talk to this week, and what is the money at stake?',
                'Where are we losing gross margin by ' + sl + ', and how much could we recover at the median margin?',
                cmp ? 'Explain the change in EBITDA by ' + sl + ' versus ' + cmp + ' — who drove it?' : 'Rank the ' + sl + ' values by EBITDA margin and explain the bottom 5',
                'How much operating expense sits on blank / default ' + sl + ' values, and how should we allocate it?',
                'Chart revenue and gross profit for the top 15 ' + sl + ' values',
                'Which ' + sl + ' values have revenue but no cost of sales, and what does that mean for their margin?',
                'Write a short board paragraph on performance by ' + sl]) };
        }
        if (tab === 'pages' && FL.pages && FL.pages.cur) return { title: 'This page: ' + FL.pages.cur.name, items: [
            'Add KPI cards for revenue, gross profit, EBITDA and net profit with the comparison',
            'Add a chart of revenue and expenses by month for the last 12 months',
            'Add a table of the 10 largest expense accounts with the change versus the comparison',
            'Make every widget year-to-date', 'Explain what the numbers on this page say, in 5 bullets', 'Remove the widgets that show nothing and tidy the layout'] };
        if (FL.wcp && FL.wcp.KIND[tab]) { var wk = FL.wcp.KIND[tab]; return { title: { AR: 'Debtors', AP: 'Creditors', INV: 'Inventory' }[wk], items: FL.wcp.prompts(wk) }; }
        if (tab === 'alloc' && FL.alloc && FL.alloc.doc) return { title: 'Cost allocation: ' + FL.alloc.model().name, items: [
            'Is this allocation fair? Which rule moves the most cost and is its driver the right one?',
            'Which receivers turn loss-making after allocation, and which cost pool causes it?',
            'Compare allocating head-office costs by revenue, by headcount and evenly — who wins and who loses?',
            'Propose activity-based costing: activities, their cost and the driver for each',
            'Explain this allocation for the board in 5 bullets'] };
        if (tab === 'wc') return { title: 'Working capital', items: ['Which customers are most overdue and how much is over 90 days?', 'Why did DSO change this month?', 'Which suppliers should we pay first, and which can wait?', 'Which stock is aged over 180 days and what is it worth?'] };
        if (tab === 'statements' || tab === 'overview' || tab === 'analytics') return { title: 'Statements & analytics', items: C.SUGGEST.slice(0, 8) };
        if (tab === 'closing' || tab === 'close') return { title: 'Close', items: ['Run the month-end close for this period', 'Write the variance commentary for this month', 'Build the roll-forward of trade receivables', 'Which accounts do not reconcile this month?'] };
        if (tab === 'journals') return { title: 'Journal risk', items: ['Are there unusual or risky journals this month?', 'Which users posted journals outside working hours?', 'Show manual journals above the materiality limit'] };
        return { title: 'Suggestions', items: C.SUGGEST.slice(0, 6) };
    };
    C.paintSuggest = function () {
        var box = $('cop-sugs'); if (!box) return;
        var p = C.pagePrompts();
        $('cop-sugbar').querySelector('summary').textContent = 'Suggested for ' + p.title;
        box.innerHTML = p.items.map(function (q) { return '<a class="cop-sug" data-fill="' + esc(q) + '">' + esc(q) + '</a>'; }).join('');
        box.querySelectorAll('[data-fill]').forEach(function (a) { a.onclick = function () { var t = $('cop-q'); t.value = a.dataset.fill; t.focus(); t.setSelectionRange(t.value.length, t.value.length); }; });
    };
    C.close = function () { C.open = false; if ($('cop')) $('cop').classList.remove('open'); document.body.classList.remove('cop-on'); };
    C.save = function () { FL.lsSet('copilot', C.msgs.slice(-30).map(function (m) { return { role: m.role, content: m.content, steps: m.steps, error: m.error, cost: m.cost }; })); };

    C.paint = function () {
        var b = $('cop-b'); if (!b) return;
        C.charts.forEach(function (c) { try { c.destroy(); } catch (e) { /* gone */ } }); C.charts = [];
        if (!C.msgs.length) {
            b.innerHTML = '<div class="cop-hello"><p>Ask anything about the numbers — I read the same ledger as the statements, explain the drivers down to accounts, cost centres and journals, and draw a chart when it helps.</p>' +
                C.SUGGEST.map(function (s) { return '<a class="cop-sug" data-ask="' + esc(s) + '">' + esc(s) + '</a>'; }).join('') + '</div>';
            return;
        }
        b.innerHTML = C.msgs.map(function (m, i) {
            if (m.role === 'user') return '<div class="cop-m u">' + esc(m.content) + '</div>';
            return '<div class="cop-m a" data-i="' + i + '">' + (m.steps && m.steps.length ? '<details class="cop-steps"><summary>' + (m.pending ? '<i class="fa-solid fa-circle-notch fa-spin"></i> ' + esc(String(m.steps[m.steps.length - 1]).slice(0, 90)) + ' · ' : '') + m.steps.length + ' step(s)</summary>' + m.steps.map(function (s) { return '<div>' + esc(s) + '</div>'; }).join('') + '</details>' : (m.pending ? '<div class="muted"><i class="fa-solid fa-circle-notch fa-spin"></i> Thinking…</div>' : '')) +
                (m.error ? '<div class="callout bad">' + esc(m.error) + '</div>' : C.md(m.content || '', i)) +
                (m.cost != null && !m.pending ? '<div class="cop-cost">$' + m.cost.toFixed(3) + '</div>' : '') + '</div>';
        }).join('');
        b.querySelectorAll('[data-page]').forEach(function (bt) { bt.onclick = function () { if (!FL.pages) return; var pg = FL.pages.parse('```page\n' + decodeURIComponent(bt.dataset.page) + '\n```'); if (!pg) { FL.toast('That page design is not valid', 'err'); return; } FL.pages.load().then(function () { FL.pages.apply(pg); }); }; });
        b.querySelectorAll('canvas[data-chart]').forEach(function (cv) {
            try {
                var spec = JSON.parse(decodeURIComponent(cv.dataset.chart)), pal = FL.PAL.series;
                var type = { bar: 'bar', line: 'line', pie: 'doughnut', doughnut: 'doughnut', column: 'bar' }[spec.type] || 'bar';
                C.charts.push(new Chart(cv, {
                    type: type, data: { labels: spec.labels || [], datasets: (spec.datasets || []).slice(0, 6).map(function (d, k) {
                        return { label: d.label, data: d.data, backgroundColor: type === 'doughnut' ? pal : pal[k % pal.length], borderColor: pal[k % pal.length], borderWidth: type === 'line' ? 2 : 0, tension: 0.25, pointRadius: type === 'line' ? 2 : 0, borderRadius: 3 };
                    }) },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { title: { display: !!spec.title, text: spec.title }, legend: { labels: { boxWidth: 10, font: { size: 10 } } } },
                        scales: type === 'doughnut' ? {} : { y: { ticks: { callback: function (v) { return FL.compact(v); }, font: { size: 10 } } }, x: { ticks: { font: { size: 10 } } } } }
                }));
            } catch (e) { cv.parentNode.innerHTML = '<span class="sm muted">chart could not be drawn</span>'; }
        });
        b.scrollTop = b.scrollHeight;
    };

    // ── Markdown (escaped first; only our own tags are produced) ──
    function inline(s) {
        return s.replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
            .replace(/\[([^\]]+)\]\(((?:acct|je|cc|period|ask):[^)]*)\)/g, function (_, t, h) { return '<a class="cop-lnk" data-href="' + h.replace(/"/g, '&quot;') + '">' + t + '</a>'; })
            .replace(/\[([^\]]+)\]\((https?:[^)]*)\)/g, '$1');
    }
    C.md = function (text, mi) {
        var out = [], lines = esc(text).split('\n'), i = 0, n = 0;
        while (i < lines.length) {
            var l = lines[i];
            var fence = /^```\s*(\w*)/.exec(l);
            if (fence) {
                var body = []; i++;
                while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
                i++;
                var raw = body.join('\n').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
                if (fence[1] === 'page') { var pw = 0; try { pw = (JSON.parse(raw).widgets || []).length; } catch (e) { pw = -1; }
                    out.push('<div class="cop-page"><i class="fa-regular fa-file-lines"></i> A page design' + (pw >= 0 ? ' · ' + pw + ' widget(s)' : ' (not valid JSON)') + (pw >= 0 ? ' <button class="btn sm primary" data-page="' + encodeURIComponent(raw) + '">' + (FL.pages && FL.pages.cur && FL.tab === 'pages' ? 'Apply to this page' : 'Open as a new page') + '</button>' : '') + '</div>'); continue; }
                if (fence[1] === 'chart') out.push('<div class="cop-chart"><canvas data-chart="' + encodeURIComponent(raw) + '" id="copc' + mi + '_' + (n++) + '"></canvas></div>');
                else out.push('<pre>' + body.join('\n') + '</pre>');
                continue;
            }
            if (/^\s*\|.*\|\s*$/.test(l)) {
                var rows = [];
                while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++]);
                var cells = function (r) { return r.trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim(); }); };
                var head = cells(rows[0]), bodyRows = rows.slice(/^[\s|:-]+$/.test(rows[1] || '') ? 2 : 1);
                var num = function (c) { return /^[−\-(]?[$€£]?[\d,.]+%?[)]?[A-Za-z]{0,3}$/.test(c.replace(/<[^>]+>/g, '')); };
                out.push('<div class="scroll"><table class="t"><thead><tr>' + head.map(function (c) { return '<th>' + inline(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
                    bodyRows.map(function (r) { return '<tr>' + cells(r).map(function (c) { return '<td class="' + (num(c) ? 'n' : '') + '">' + inline(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>');
                continue;
            }
            var hm = /^(#{1,4})\s+(.*)$/.exec(l);
            if (hm) { out.push('<h' + (hm[1].length + 3 > 6 ? 6 : hm[1].length + 3) + '>' + inline(hm[2]) + '</h' + (hm[1].length + 3 > 6 ? 6 : hm[1].length + 3) + '>'); i++; continue; }
            if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
                var ord = /^\s*\d+\./.test(l), items = [];
                while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ''));
                out.push('<' + (ord ? 'ol' : 'ul') + '>' + items.map(function (x) { return '<li>' + inline(x) + '</li>'; }).join('') + '</' + (ord ? 'ol' : 'ul') + '>');
                continue;
            }
            if (/^&gt;\s?/.test(l)) {
                var q = [];
                while (i < lines.length && /^&gt;\s?/.test(lines[i])) q.push(lines[i++].replace(/^&gt;\s?/, ''));
                out.push('<blockquote>' + inline(q.join('<br>')) + '</blockquote>');
                continue;
            }
            if (/^\s*(---|\*\*\*)\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
            if (l.trim()) out.push('<p>' + inline(l) + '</p>');
            i++;
        }
        return out.join('');
    };

    C.onLink = function (e) {
        var a = e.target.closest('[data-ask],[data-href]'); if (!a) return;
        if (a.dataset.ask) { C.ask(a.dataset.ask); return; }
        var h = a.dataset.href, k = h.slice(0, h.indexOf(':')), v = decodeURIComponent(h.slice(h.indexOf(':') + 1)).trim();
        if (k === 'ask') { C.ask(v); return; }
        if (k === 'je') { FL.journal(+v); return; }
        if (k === 'acct') {
            FL.data().then(function (data) {
                var col = { id: 'ytd', scenario: 'ACTUAL', range: 'YTD' };
                FL.drillAccount(v, { tpl: { name: 'Copilot' }, row: { label: 'Copilot' }, col: col, seqs: FINE.windowSeqs(col, data, FL.filter.period), label: 'Year to date ' + FL.periodName(FL.filter.period) });
            });
            return;
        }
        if (k === 'cc' || k === 'period') {
            if (k === 'cc' && FL.dims.ccs.some(function (c) { return c.code === v; })) { FL.filter.cc = v; $('f-cc').value = v; }
            if (k === 'period' && FL.dims.periods.some(function (p) { return p.period_seq === +v; })) { FL.filter.period = +v; $('f-period').value = v; }
            FL.lsSet('filter', FL.filter); FL.cache = {}; FL.render();
            $('cop-ctx').textContent = FL.filterText() + ' · ' + FL.periodName(FL.filter.period);
        }
    };

    /** What the CFO sees: filter, key statement lines (raw amounts) for the main columns, KPIs and monitor status. */
    C.context = function () {
        if (!FL.status || !FL.status.loaded) return Promise.resolve({ loaded: false });
        return FL.data().then(function (data) {
            var opts = { period: FL.filter.period, scale: 1 }, tm = FL.tplMap(), out = {
                filter: { period: FL.periodName(FL.filter.period), period_seq: FL.filter.period, ledger: FL.filter.ledger || 'all', company: FL.filter.company || 'all', cost_centre: FL.filter.cc || 'all', text: FL.filterText() },
                currency: ((FL.status.meta || {}).currencies || (FL.status.meta || {}).currency || ''),
                ledgers: FL.dims.ledgers, companies: FL.dims.companies.slice(0, 50),
                note: 'Statement lines are shown with the sign of the statement (revenue, profit and liabilities positive), in currency units, for the columns listed. KPIs are for the period in the filter.',
                statements: {}, kpis: {}, monitors: []
            };
            var r0 = function (v) { return v == null ? null : Math.round(v * 100) / 100; };
            ['PL', 'BS', 'CF'].forEach(function (id) {
                if (!tm[id]) return;
                var st = FINE.compute(tm[id], data, opts), cols = st.columns.map(function (c, i) { return { c: c, i: i }; }).filter(function (x) { return x.c.kind === 'value'; }).slice(0, 6);
                out.statements[id] = { name: tm[id].name, columns: cols.map(function (x) { return x.c.label; }),
                    lines: st.rows.filter(function (r) { return r.id && r.type !== 'header' && r.type !== 'blank' && r.type !== 'text'; }).map(function (r) { return [r.id, r.label].concat(cols.map(function (x) { return r0(r.raw[x.i]); })); }) };
            });
            try {
                var k = FINE.kpis(FL.config.kpis || [], tm, data, FL.filter.period);
                (FL.config.kpis || []).forEach(function (d) { if (k[d.id] && k[d.id].value != null) out.kpis[d.label] = r0(k[d.id].value) + (d.fmt === 'pct' ? ' %' : d.fmt === 'days' ? ' days' : d.fmt === 'ratio' ? '×' : ''); });
                out.monitors = FINE.monitor(FL.config.monitors || [], k).filter(function (m) { return m.status === 'breach' || m.status === 'bad' || m.status === 'alert'; }).map(function (m) { return m.rule.label; });
            } catch (e) { out.kpiError = String(e.message || e); }
            if ((FL.tab === 'segpl' || FL.tab === 'segai') && FL.segpl && FL.segpl.ai && FL.segpl.st.groups && FL.segpl.st.groups.length) { try { out.segmentPL = FL.segpl.ai.context(); } catch (e) { /* not loaded */ } }
            if (FL.tab === 'pages' && FL.pages && FL.pages.cur) { var dc = FL.pages.designContext(); out.openPage = dc.page; out.pageParameters = dc.parameters_now;
                out.pageGuide = 'The user is on their own page "' + FL.pages.cur.name + '" (My pages). When they ask to add, change or remove something on it, follow this guide and answer with ONE ```page block of the whole page:\n' + FL.pages.GUIDE; }
            if (FL.tab === 'alloc' && FL.alloc && FL.alloc.doc) { try { out.costAllocation = FL.alloc.context(); out.costAllocationGuide = 'The user is on Cost allocation. To add or change rules answer with ONE ```alloc block: ' + FL.alloc.GUIDE; } catch (e) { /* not loaded */ } }
            if (FL.wcp && FL.wcp.KIND[FL.tab]) { try { out.thisPage = FL.wcp.context(); } catch (e) { /* not drawn yet */ } }
            return FL.wc ? FL.wc.summary().then(function (w) { if (w) out.workingCapital = w; return out; }) : out;
        });
    };

    C.ask = function (q) {
        q = String(q || '').trim();
        if (!q || C.busy) return;
        if (!C.open) C.show();
        $('cop-q').value = '';
        var history = C.msgs.filter(function (m) { return !m.error && !m.pending; }).slice(-8).map(function (m) { return { role: m.role, content: m.content }; });
        C.msgs.push({ role: 'user', content: q });
        var a = { role: 'assistant', content: '', steps: [], pending: true };
        C.msgs.push(a);
        C.busy = true; C.paint();
        $('cop-send').innerHTML = '<i class="fa-solid fa-stop"></i>'; $('cop-send').title = 'Stop';
        var done = function () { C.busy = false; a.pending = false; C.save(); C.paint(); $('cop-send').innerHTML = '<i class="fa-solid fa-paper-plane"></i>'; $('cop-send').title = 'Send'; };
        C.context().then(function (ctx) {
            return FL.call('finAsk', { question: q, history: history, context: JSON.stringify(ctx) }, 11 * 60000, function (msg) {
                if (!msg || /^(Reading the numbers|Checking the ledger|Writing the answer)/.test(msg)) return;
                a.steps.push(msg); C.paint();
            });
        }).then(function (r) {
            a.content = r.answer || ''; a.steps = r.steps || a.steps; a.cost = r.costUsd; a.queries = r.queries;
            done();
        }).catch(function (e) { a.error = String(e && e.message || e); done(); });
    };

    /** "Ask the Copilot" from anywhere (e.g. a statement line) */
    FL.askCopilot = function (q) { C.show(); if (q && $('cop-q')) { $('cop-q').value = q; $('cop-q').focus(); } };   // fills the box — the user sends it
})();
