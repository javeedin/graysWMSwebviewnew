/* Finance Lens — My pages (tab `pages`, FL.pages): pages the CFO designs, saves and reopens. A page = parameters (periods, compare,
   companies, ledger) + widgets on a 12-column grid; every widget is one read-only DuckDB query (placeholders {PERIODS} {CMP_PERIODS}
   {LEDGER} {COMPANY_FILTER} {COMPANIES} filled from the page's parameters) shown as a KPI, bar / line / pie chart or table, or a
   Markdown note. The CFO edits widgets by hand (title, type, width, SQL, order) or tells the Copilot what to build / change: the
   Copilot gets the page JSON + the design guide (P.GUIDE), checks its SQL with run_sql and answers with one ```page block, shown as
   a preview to apply. Pages live in {root}\pages.json (finDocGet / finDocSave name `pages`); the Copilot drawer also knows the open
   page (context.page) and offers "Apply to this page" for a ```page block. */
(function () {
    var P = FL.pages = { doc: null, cur: null, edit: false, charts: [], busy: false };
    var esc = window.esc;
    var uid = function () { return 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); };
    var money = function (v) { return v == null || isNaN(v) ? '–' : FINE.fmt(+v / (FL.filter.scale || 1), 'num', { decimals: FL.filter.scale >= 1000000 ? 1 : 0 }); };
    var TYPES = [['kpi', 'KPI card'], ['bar', 'Bar chart'], ['hbar', 'Bar chart (horizontal)'], ['line', 'Line chart'], ['pie', 'Donut'], ['table', 'Table'], ['text', 'Note (Markdown)']];

    P.GUIDE = [
        'You design pages for the CFO in Finance Lens. A page is JSON: {"name": "...", "widgets": [ {"type": "kpi|bar|hbar|line|pie|table|text", "title": "...", "w": 3|4|6|8|12, "sql": "...", "md": "...", "fmt": "money|pct|num", "note": "one line explaining the widget"} ]}.',
        'Widgets sit on a 12-column grid in order (w = width; 4 KPIs of w 3 make one row; charts usually 6 or 12; tables 6–12).',
        'Each widget except text runs ONE read-only DuckDB query (SELECT or WITH). Shapes: kpi → one row with columns value (and optionally compare = the same figure for the comparison periods); bar / hbar / line / pie → first column = label (period name, account, company …), then 1–4 numeric columns of the SAME unit (one axis only); table → any columns, ≤ 500 rows.',
        'Placeholders the page fills in: {PERIODS} = comma list of the chosen period_seq (yyyymm); {CMP_PERIODS} = the comparison period_seq list (same length; 0 when no comparison); {LEDGER} = ledger_id (numeric, for fin_gl_ext_v); {COMPANY_FILTER} = " AND company IN (...)" or empty; {COMPANIES} = the quoted list or all.',
        'Tables: fin_balances (scenario ACTUAL/BUDGET, company, cost_centre, account, period_name, period_seq, begin_bal, period_dr, period_cr, period_net = dr - cr, end_bal) — the trial balance by company × cost centre × account; fin_accounts (code, name, account_type R revenue / E expense / A asset / L liability / O equity, class); fin_periods (period_name, period_seq, fiscal_year, period_num, quarter); fin_companies (code, name); fin_cost_centres (code, name); fin_gl_ext_v (ledger_id, period_seq, period_name, adj, company, account, account_type, segment1..segment30, opening, dr, cr, closing) — balances by the extended segments (e.g. salesperson = the segment column named in the context); fin_segment_values (coa_id, column_name, value, description) for segment names.',
        'Signs: revenue = -SUM(period_net) for account_type R; costs = SUM(period_net) for account_type E; profit = -SUM(period_net) over R and E. In fin_gl_ext_v use cr - dr for income and dr - cr for costs. Always filter fin_balances with scenario = \'ACTUAL\' (BUDGET for budget) AND period_seq IN ({PERIODS}){COMPANY_FILTER}.',
        'Before answering, run every widget query once with run_sql (with the placeholders replaced by the values in the context) and fix it until it works. Answer with ONE ```page block holding the WHOLE page (keep the widgets you were not asked to change, with their sql unchanged), then at most 3 short lines on what you changed.'
    ].join('\n');

    P.STARTERS = [
        { name: 'CFO cockpit', widgets: [
            { type: 'kpi', title: 'Revenue', w: 3, fmt: 'money', sql: "SELECT -SUM(CASE WHEN b.period_seq IN ({PERIODS}) THEN b.period_net END) AS value, -SUM(CASE WHEN b.period_seq IN ({CMP_PERIODS}) THEN b.period_net END) AS compare FROM fin_balances b JOIN fin_accounts a ON a.code = b.account WHERE b.scenario = 'ACTUAL' AND a.account_type = 'R'{COMPANY_FILTER}" },
            { type: 'kpi', title: 'Expenses', w: 3, fmt: 'money', sql: "SELECT SUM(CASE WHEN b.period_seq IN ({PERIODS}) THEN b.period_net END) AS value, SUM(CASE WHEN b.period_seq IN ({CMP_PERIODS}) THEN b.period_net END) AS compare FROM fin_balances b JOIN fin_accounts a ON a.code = b.account WHERE b.scenario = 'ACTUAL' AND a.account_type = 'E'{COMPANY_FILTER}" },
            { type: 'kpi', title: 'Profit', w: 3, fmt: 'money', sql: "SELECT -SUM(CASE WHEN b.period_seq IN ({PERIODS}) THEN b.period_net END) AS value, -SUM(CASE WHEN b.period_seq IN ({CMP_PERIODS}) THEN b.period_net END) AS compare FROM fin_balances b JOIN fin_accounts a ON a.code = b.account WHERE b.scenario = 'ACTUAL' AND a.account_type IN ('R', 'E'){COMPANY_FILTER}" },
            { type: 'kpi', title: 'Profit margin', w: 3, fmt: 'pct', sql: "SELECT 100 * SUM(CASE WHEN a.account_type IN ('R','E') THEN -b.period_net END) / NULLIF(SUM(CASE WHEN a.account_type = 'R' THEN -b.period_net END), 0) AS value FROM fin_balances b JOIN fin_accounts a ON a.code = b.account WHERE b.scenario = 'ACTUAL' AND b.period_seq IN ({PERIODS}){COMPANY_FILTER}" },
            { type: 'line', title: 'Revenue and expenses by month', w: 8, fmt: 'money', sql: "SELECT ANY_VALUE(b.period_name) AS period, -SUM(CASE WHEN a.account_type = 'R' THEN b.period_net END) AS revenue, SUM(CASE WHEN a.account_type = 'E' THEN b.period_net END) AS expenses FROM fin_balances b JOIN fin_accounts a ON a.code = b.account WHERE b.scenario = 'ACTUAL'{COMPANY_FILTER} GROUP BY b.period_seq ORDER BY b.period_seq" },
            { type: 'text', title: 'Notes', w: 4, md: 'Write what matters this month here — or ask the Copilot to change this page.' },
            { type: 'hbar', title: 'Largest expense accounts', w: 6, fmt: 'money', sql: "SELECT a.code || ' · ' || COALESCE(a.name, '') AS account, SUM(b.period_net) AS amount FROM fin_balances b JOIN fin_accounts a ON a.code = b.account WHERE b.scenario = 'ACTUAL' AND a.account_type = 'E' AND b.period_seq IN ({PERIODS}){COMPANY_FILTER} GROUP BY 1 ORDER BY 2 DESC LIMIT 12" },
            { type: 'table', title: 'Revenue by company', w: 6, fmt: 'money', sql: "SELECT b.company, ANY_VALUE(c.name) AS name, -SUM(CASE WHEN b.period_seq IN ({PERIODS}) THEN b.period_net END) AS revenue, -SUM(CASE WHEN b.period_seq IN ({CMP_PERIODS}) THEN b.period_net END) AS comparison FROM fin_balances b JOIN fin_accounts a ON a.code = b.account LEFT JOIN fin_companies c ON c.code = b.company WHERE b.scenario = 'ACTUAL' AND a.account_type = 'R'{COMPANY_FILTER} GROUP BY 1 ORDER BY 3 DESC NULLS LAST" }
        ] }
    ];

    // ── storage ──
    P.load = function () {
        if (P.doc) return Promise.resolve(P.doc);
        return FL.call('finDocGet', { name: 'pages' }).then(function (r) { try { P.doc = JSON.parse(r.json || '{}'); } catch (e) { P.doc = {}; } P.doc.pages = P.doc.pages || []; return P.doc; })
            .catch(function () { P.doc = { pages: [] }; return P.doc; });
    };
    P.store = function () { P.cur && (P.cur.updated = new Date().toISOString()); return FL.call('finDocSave', { name: 'pages', json: JSON.stringify(P.doc, null, 1) }).then(function () { P.dirty = false; P.paintHead(); }); };
    P.newPage = function (base) {
        var pg = JSON.parse(JSON.stringify(base || { name: 'New page', widgets: [] }));
        pg.id = 'p' + Date.now().toString(36); pg.owner = (FL.who || {}).user || ''; pg.created = new Date().toISOString();
        pg.params = pg.params || { periods: P.defPeriods(), cmp: 'py', companies: [], ledger: null };
        (pg.widgets || []).forEach(function (w) { w.id = w.id || uid(); });
        P.doc.pages.unshift(pg); P.cur = pg; FL.lsSet('pages.cur', pg.id);
        return P.store();
    };
    P.defPeriods = function () { var ps = (FL.dims.periods || []).map(function (p) { return p.period_seq; }); var cur = FL.filter.period; return cur && ps.indexOf(cur) >= 0 ? [cur] : ps.slice(-1); };

    // ── parameters → SQL ──
    P.cmpSeqs = function (pg) {
        var ps = (pg.params.periods || []).slice().sort(), all = (FL.dims.periods || []).map(function (p) { return p.period_seq; }).sort();
        if (pg.params.cmp === 'py') return ps.map(function (q) { return q - 100; });
        if (pg.params.cmp === 'prev') { var i0 = all.indexOf(ps[0]); return ps.map(function (q, k) { var j = i0 - ps.length + k; return j >= 0 ? all[j] : 0; }); }
        return [0];
    };
    P.fill = function (sql, pg) {
        var q = function (v) { return "'" + String(v).replace(/'/g, "''") + "'"; }, cos = pg.params.companies || [], ps = (pg.params.periods || []).length ? pg.params.periods : [0];
        return String(sql || '').replace(/\{PERIODS\}/g, ps.join(',')).replace(/\{CMP_PERIODS\}/g, P.cmpSeqs(pg).join(','))
            .replace(/\{LEDGER\}/g, pg.params.ledger != null ? +pg.params.ledger : 'ledger_id')
            .replace(/\{COMPANY_FILTER\}/g, cos.length ? ' AND company IN (' + cos.map(q).join(',') + ')' : '')
            .replace(/\{COMPANIES\}/g, cos.length ? cos.map(q).join(',') : 'ALL');
    };
    P.pname = function (q) { var p = (FL.dims.periods || []).filter(function (x) { return x.period_seq === +q; })[0]; if (p) return p.period_name;
        var m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][(+q % 100) - 1]; return m ? m + '-' + String(Math.floor(+q / 100)).slice(2) + ' (not synced)' : String(q); };

    // ── page ──
    FL.TABS.pages = { render: function (el) { return P.render(el); } };
    P.render = function (el) {
        el.innerHTML = '<div class="empty"><i class="fa-solid fa-circle-notch fa-spin"></i></div>';
        return P.load().then(function () {
            var want = FL.ls('pages.cur', null);
            P.cur = P.doc.pages.filter(function (p) { return p.id === want; })[0] || P.doc.pages[0] || null;
            el.innerHTML = '<div class="pg-wrap"><aside class="pg-side card"><div class="row"><b>My pages</b><span class="grow"></span><button class="btn sm primary" id="pg-new" title="New page"><i class="fa-solid fa-plus"></i></button></div><div id="pg-list"></div>' +
                '<div class="pg-start"><div class="sm muted" style="margin:10px 0 4px">Start from</div>' + P.STARTERS.map(function (s, i) { return '<a class="pg-st" data-st="' + i + '"><i class="fa-solid fa-wand-sparkles"></i> ' + esc(s.name) + '</a>'; }).join('') +
                '<a class="pg-st" id="pg-ai-new"><i class="fa-solid fa-robot"></i> Describe it to the Copilot…</a></div></aside><section class="pg-main" id="pg-main"></section></div>';
            $('pg-new').onclick = function () { P.newPage().then(P.paint); };
            el.querySelectorAll('[data-st]').forEach(function (a) { a.onclick = function () { P.newPage(P.STARTERS[+a.dataset.st]).then(P.paint); }; });
            $('pg-ai-new').onclick = function () { P.newPage({ name: 'New page', widgets: [] }).then(function () { P.paint(); setTimeout(function () { var i = $('pg-ask'); if (i) { i.focus(); i.placeholder = 'Describe the page you want — e.g. "monthly revenue, gross profit and EBITDA for the last 12 months, top 10 customers… "'; } }, 50); }); };
            P.paint();
        });
    };
    P.paintList = function () {
        var el = $('pg-list'); if (!el) return;
        el.innerHTML = P.doc.pages.length ? P.doc.pages.map(function (p) { return '<a class="pg-li' + (P.cur && p.id === P.cur.id ? ' on' : '') + '" data-p="' + p.id + '"><i class="fa-regular fa-file-lines"></i> ' + esc(p.name) + '<span class="sm muted">' + (p.widgets || []).length + '</span></a>'; }).join('')
            : '<p class="sm muted">No pages yet — start from the CFO cockpit, a blank page, or describe one to the Copilot.</p>';
        el.querySelectorAll('[data-p]').forEach(function (a) { a.onclick = function () { P.cur = P.doc.pages.filter(function (p) { return p.id === a.dataset.p; })[0]; FL.lsSet('pages.cur', P.cur.id); P.edit = false; P.paint(); }; });
    };
    P.paint = function () {
        P.paintList();
        var m = $('pg-main'); if (!m) return;
        P.charts.forEach(function (c) { try { c.destroy(); } catch (e) { /* gone */ } }); P.charts = [];
        if (!P.cur) { m.innerHTML = '<div class="card"><h2 style="margin-top:0"><i class="fa-regular fa-file-lines"></i> My pages</h2><p>Build your own pages: KPI cards, charts, tables and notes over the ledger on this PC — by hand, or by telling the Copilot what you want to see. Saved pages open again next time with fresh numbers.</p></div>'; return; }
        var pg = P.cur, pr = pg.params, ps = FL.dims.periods || [];
        var years = {}; ps.forEach(function (p) { (years[Math.floor(p.period_seq / 100)] = years[Math.floor(p.period_seq / 100)] || []).push(p); });
        m.innerHTML = '<div class="card pg-head" id="pg-head"></div>' +
            '<div class="card pg-params"><div class="row" style="gap:10px;flex-wrap:wrap"><b class="sm">Periods</b>' +
            '<span class="pg-quick">' + [['last', 'Last'], ['q', 'Quarter'], ['ytd', 'YTD'], ['12', '12 m']].map(function (x) { return '<a data-q="' + x[0] + '">' + x[1] + '</a>'; }).join(' · ') + '</span>' +
            '<select id="pg-per" multiple size="1" style="display:none"></select>' +
            '<span class="pg-pers">' + Object.keys(years).sort().reverse().slice(0, 3).map(function (y) { return '<span class="sm muted">' + y + '</span> ' + years[y].map(function (p) { return '<label class="chip' + ((pr.periods || []).indexOf(p.period_seq) >= 0 ? ' on' : '') + '"><input type="checkbox" data-ps="' + p.period_seq + '"' + ((pr.periods || []).indexOf(p.period_seq) >= 0 ? ' checked' : '') + '>' + esc(String(p.period_name).slice(0, 3)) + '</label>'; }).join(''); }).join(' ') + '</span>' +
            '<label class="sm">Compare with <select id="pg-cmp">' + [['py', 'same period last year'], ['prev', 'previous period(s)'], ['none', 'nothing']].map(function (o) { return '<option value="' + o[0] + '"' + (pr.cmp === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
            '<label class="sm">Companies <select id="pg-co"><option value="">all</option>' + (FL.dims.companies || []).map(function (c) { return '<option value="' + esc(c.code) + '"' + ((pr.companies || [])[0] === c.code ? ' selected' : '') + '>' + esc(c.code + (c.name && c.name !== c.code ? ' · ' + c.name : '')) + '</option>'; }).join('') + '</select></label>' +
            '<span class="sm muted">' + esc((pr.periods || []).map(P.pname).join(', ') || 'no period') + (pr.cmp !== 'none' ? ' vs ' + esc(P.cmpSeqs(pg).map(P.pname).join(', ')) : '') + ' · amounts in ' + FL.scaleLabel() + '</span></div></div>' +
            '<div class="pg-grid' + (P.edit ? ' editing' : '') + '" id="pg-grid"></div>' +
            '<div class="card pg-askbar"><div class="row" style="gap:8px"><i class="fa-solid fa-robot"></i><input id="pg-ask" placeholder="Tell the Copilot what to change on this page — e.g. add a chart of gross profit by salesperson, make the KPIs year-to-date…" style="flex:1">' +
            '<button class="btn primary" id="pg-askgo"><i class="fa-solid fa-wand-magic-sparkles"></i> Design</button></div><div id="pg-ai"></div></div>';
        P.paintHead();
        // parameters
        m.querySelectorAll('[data-ps]').forEach(function (c) { c.onchange = function () { var v = +c.dataset.ps, i = pr.periods.indexOf(v); if (c.checked && i < 0) pr.periods.push(v); if (!c.checked && i >= 0) pr.periods.splice(i, 1); pr.periods.sort(); P.dirty = true; P.paint(); }; });
        m.querySelectorAll('[data-q]').forEach(function (a) { a.onclick = function () {
            var all = ps.map(function (p) { return p.period_seq; }).sort(), last = all[all.length - 1], k = a.dataset.q, y = Math.floor(last / 100);
            pr.periods = k === 'last' ? [last] : k === '12' ? all.slice(-12) : k === 'ytd' ? all.filter(function (x) { return Math.floor(x / 100) === y && x <= last; }) : all.filter(function (x) { return Math.floor(x / 100) === y && Math.ceil((x % 100) / 3) === Math.ceil((last % 100) / 3) && x <= last; });
            P.dirty = true; P.paint(); }; });
        $('pg-cmp').onchange = function () { pr.cmp = this.value; P.dirty = true; P.paint(); };
        $('pg-co').onchange = function () { pr.companies = this.value ? [this.value] : []; P.dirty = true; P.paint(); };
        $('pg-askgo').onclick = function () { var t = $('pg-ask').value.trim(); if (t) P.design(t); };
        $('pg-ask').onkeydown = function (e) { if (e.key === 'Enter') $('pg-askgo').click(); };
        P.paintGrid();
        if (P.preview) P.paintPreview();
    };
    P.paintHead = function () {
        var h = $('pg-head'); if (!h || !P.cur) return;
        h.innerHTML = '<div class="row" style="gap:8px;flex-wrap:wrap"><input id="pg-name" class="pg-name" value="' + esc(P.cur.name) + '"' + (P.edit ? '' : ' readonly') + '>' +
            (P.dirty ? '<span class="tag warn">not saved</span>' : '<span class="sm muted">' + (P.cur.updated ? 'saved ' + String(P.cur.updated).slice(0, 16).replace('T', ' ') : '') + '</span>') + '<span class="grow"></span>' +
            '<button class="btn sm' + (P.edit ? ' primary' : '') + '" id="pg-edit"><i class="fa-solid fa-pen-ruler"></i> ' + (P.edit ? 'Done editing' : 'Edit page') + '</button>' +
            (P.edit ? '<button class="btn sm" id="pg-add"><i class="fa-solid fa-plus"></i> Add widget</button>' : '') +
            '<button class="btn sm' + (P.dirty ? ' primary' : '') + '" id="pg-save"><i class="fa-solid fa-floppy-disk"></i> Save</button>' +
            '<button class="btn sm ghost" id="pg-refresh" title="Run every widget again"><i class="fa-solid fa-rotate"></i></button>' +
            '<button class="btn sm ghost" id="pg-more" title="Duplicate, export, import, delete"><i class="fa-solid fa-ellipsis"></i></button></div>';
        $('pg-name').oninput = function () { P.cur.name = this.value; P.dirty = true; };
        $('pg-name').onchange = function () { P.paintList(); P.paintHead(); };
        $('pg-edit').onclick = function () { P.edit = !P.edit; P.paint(); };
        if ($('pg-add')) $('pg-add').onclick = function () { P.editWidget(null); };
        $('pg-save').onclick = function () { P.store().then(function () { FL.toast('Page saved', 'ok'); P.paintList(); }); };
        $('pg-refresh').onclick = function () { P.paintGrid(); };
        $('pg-more').onclick = P.more;
    };
    P.more = function () {
        FL.modal('<i class="fa-regular fa-file-lines"></i> ' + esc(P.cur.name), '<div class="pg-morelist">' +
            '<button class="btn" id="pm-dup"><i class="fa-solid fa-copy"></i> Duplicate</button> <button class="btn" id="pm-exp"><i class="fa-solid fa-download"></i> Export (.json)</button> ' +
            '<label class="btn"><i class="fa-solid fa-upload"></i> Import a page<input type="file" id="pm-imp" accept=".json" hidden></label> <button class="btn" id="pm-del"><i class="fa-solid fa-trash"></i> Delete this page</button></div>' +
            '<p class="sm muted">Pages are kept on this PC in the Finance Lens folder (pages.json). Export / import moves one to another PC.</p>');
        $('pm-dup').onclick = function () { var c = JSON.parse(JSON.stringify(P.cur)); c.name += ' (copy)'; delete c.id; FL.closeModal(); P.newPage(c).then(P.paint); };
        $('pm-exp').onclick = function () { FL.download(P.cur.name.replace(/[^\w -]+/g, '') + '.page.json', new Blob([JSON.stringify(P.cur, null, 1)], { type: 'application/json' })); };
        $('pm-imp').onchange = function () { var f = this.files[0]; if (!f) return; f.text().then(function (t) { var pg = JSON.parse(t); delete pg.id; FL.closeModal(); return P.newPage(pg).then(P.paint); }).catch(function (e) { FL.toast('Not a page file: ' + e.message, 'err'); }); };
        $('pm-del').onclick = function () { if (!confirm('Delete the page "' + P.cur.name + '"?')) return; P.doc.pages = P.doc.pages.filter(function (p) { return p !== P.cur; }); P.cur = P.doc.pages[0] || null; FL.closeModal(); P.store().then(P.paint); };
    };

    // ── widgets ──
    P.paintGrid = function () {
        var g = $('pg-grid'); if (!g || !P.cur) return;
        P.charts.forEach(function (c) { try { c.destroy(); } catch (e) { /* gone */ } }); P.charts = [];
        var ws = P.cur.widgets || [];
        g.innerHTML = ws.length ? ws.map(function (w, i) {
            return '<div class="card pg-w pg-' + w.type + '" style="grid-column: span ' + Math.max(2, Math.min(12, +w.w || 6)) + '" data-w="' + w.id + '"><div class="pg-wh"><b>' + esc(w.title || '') + '</b>' + (w.note ? '<span class="sm muted" title="' + esc(w.note) + '"> <i class="fa-regular fa-circle-question"></i></span>' : '') + '<span class="grow"></span>' +
                (P.edit ? '<a data-a="left" title="Narrower">◂</a><a data-a="right" title="Wider">▸</a><a data-a="up" title="Move up">▲</a><a data-a="down" title="Move down">▼</a><a data-a="edit" title="Edit"><i class="fa-solid fa-pen"></i></a><a data-a="del" title="Remove"><i class="fa-solid fa-xmark"></i></a>'
                    : (w.sql ? '<a data-a="data" title="Show the numbers"><i class="fa-solid fa-table"></i></a>' : '')) + '</div><div class="pg-wb" id="pgw-' + w.id + '"><div class="sm muted"><i class="fa-solid fa-circle-notch fa-spin"></i></div></div></div>';
        }).join('') : '<div class="card" style="grid-column: span 12"><p class="muted">This page is empty. ' + (P.edit ? 'Add a widget, or ' : 'Press <b>Edit page</b> to add widgets, or ') + 'tell the Copilot below what you want to see.</p></div>';
        g.querySelectorAll('[data-a]').forEach(function (a) {
            a.onclick = function () {
                var id = a.closest('.pg-w').dataset.w, i = ws.findIndex(function (w) { return w.id === id; }), w = ws[i], k = a.dataset.a;
                if (k === 'edit') return P.editWidget(w);
                if (k === 'data') return P.showData(w);
                if (k === 'del') ws.splice(i, 1);
                if (k === 'up' && i > 0) ws.splice(i - 1, 0, ws.splice(i, 1)[0]);
                if (k === 'down' && i < ws.length - 1) ws.splice(i + 1, 0, ws.splice(i, 1)[0]);
                if (k === 'left') w.w = Math.max(2, (+w.w || 6) - 1);
                if (k === 'right') w.w = Math.min(12, (+w.w || 6) + 1);
                P.dirty = true; P.paintHead(); P.paintGrid();
            };
        });
        ws.forEach(function (w) { P.renderWidget(w, $('pgw-' + w.id)); });
    };
    P.query = function (w) { return FL.sql(P.fill(w.sql, P.cur), w.type === 'table' ? 500 : 200); };
    P.fmt = function (w, v) { if (v == null || v === '') return '–'; if (typeof v !== 'number' && isNaN(+v)) return esc(v); return w.fmt === 'pct' ? (+v).toFixed(1) + '%' : w.fmt === 'num' ? FINE.fmt(+v, 'num', { decimals: 0 }) : money(+v); };
    P.renderWidget = function (w, el) {
        if (!el) return;
        if (w.type === 'text') { el.innerHTML = '<div class="cop-md">' + FL.copilot.md(w.md || '', 'pg' + w.id) + '</div>'; return; }
        if (!w.sql) { el.innerHTML = '<span class="sm muted">No query yet — edit the widget.</span>'; return; }
        P.query(w).then(function (d) {
            var cols = d.columns, rows = d.rows;
            if (w.type === 'kpi') {
                var r = rows[0] || [], vi = Math.max(0, cols.indexOf('value')), ci = cols.indexOf('compare'), v = r[vi], c = ci >= 0 ? r[ci] : null;
                var ch = c != null && +c ? (+v - +c) / Math.abs(+c) * 100 : null, good = w.good === 'down' ? ch < 0 : ch > 0;
                el.innerHTML = '<div class="pg-kv">' + P.fmt(w, v) + '</div>' + (ci >= 0 ? '<div class="sm ' + (ch == null || Math.abs(ch) < 0.05 ? 'muted' : good ? 'pos' : 'neg') + '">' + (ch == null ? 'no comparison' : (ch > 0 ? '+' : '') + ch.toFixed(1) + '% vs ' + P.fmt(w, c)) + '</div>' : '');
                return;
            }
            if (w.type === 'table') {
                var nums = cols.map(function (c, i) { return rows.length && rows.every(function (r) { return r[i] == null || typeof r[i] === 'number'; }) && rows.some(function (r) { return typeof r[i] === 'number'; }); });
                el.innerHTML = '<div class="scroll" style="max-height:' + (w.h || 360) + 'px"><table class="t"><thead><tr>' + cols.map(function (c, i) { return '<th class="' + (nums[i] ? 'n' : '') + '">' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
                    rows.map(function (r) { return '<tr>' + r.map(function (v, i) { return '<td class="' + (nums[i] ? 'n' : '') + '">' + (nums[i] ? P.fmt(w, v) : esc(v == null ? '' : v)) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>' + (d.truncated ? '<div class="sm muted">first rows only</div>' : '');
                return;
            }
            el.innerHTML = '<div class="pg-ch"><canvas></canvas></div>';
            var pal = FL.PAL.series, labels = rows.map(function (r) { return r[0] == null ? '(blank)' : String(r[0]); }), series = cols.slice(1, 5);
            var type = w.type === 'pie' ? 'doughnut' : w.type === 'line' ? 'line' : 'bar';
            var ds = series.map(function (s, k) { return { label: s, data: rows.map(function (r) { return r[k + 1] == null ? null : +r[k + 1]; }), backgroundColor: type === 'doughnut' ? pal : pal[k % pal.length], borderColor: pal[k % pal.length], borderWidth: type === 'line' ? 2 : 0, borderRadius: 4, pointRadius: type === 'line' ? 2 : 0, tension: 0.25 }; });
            if (type === 'doughnut') ds = ds.slice(0, 1);
            var axis = { ticks: { callback: function (v) { return w.fmt === 'pct' ? v + '%' : FL.compact(v / (w.fmt === 'num' ? 1 : (FL.filter.scale || 1))); }, font: { size: 10 } }, grid: { color: '#f1f5f9' } };
            P.charts.push(new Chart(el.querySelector('canvas'), { type: type, data: { labels: labels, datasets: ds },
                options: { responsive: true, maintainAspectRatio: false, indexAxis: w.type === 'hbar' ? 'y' : 'x', interaction: { mode: type === 'doughnut' ? 'nearest' : 'index', intersect: false },
                    plugins: { legend: { display: ds.length > 1 || type === 'doughnut', labels: { boxWidth: 10, font: { size: 11 } } }, tooltip: { callbacks: { label: function (c) { return (c.dataset.label ? c.dataset.label + ': ' : '') + P.fmt(w, c.raw); } } } },
                    scales: type === 'doughnut' ? {} : w.type === 'hbar' ? { x: axis, y: { ticks: { font: { size: 10 } }, grid: { display: false } } } : { y: axis, x: { ticks: { font: { size: 10 } }, grid: { display: false } } } } }));
        }).catch(function (e) {
            el.innerHTML = '<div class="callout bad sm">' + esc(String(e && e.message || e)).slice(0, 400) + '</div>' + (P.edit ? '' : '<a class="sm" data-fix="1">Ask the Copilot to fix it</a>');
            var a = el.querySelector('[data-fix]'); if (a) a.onclick = function () { P.design('The widget "' + w.title + '" fails with: ' + String(e && e.message || e).slice(0, 300) + ' — fix its SQL.'); };
        });
    };
    P.showData = function (w) {
        FL.modal(esc(w.title), '<div id="pg-dd"><i class="fa-solid fa-circle-notch fa-spin"></i></div><details><summary class="sm muted">SQL</summary><pre class="sm">' + esc(P.fill(w.sql, P.cur)) + '</pre></details>');
        P.query(w).then(function (d) { FL.grid($('pg-dd'), d.columns.map(function (c, i) { return { label: c, get: function (r) { return r[i] == null ? '' : r[i]; }, n: d.rows.some(function (r) { return typeof r[i] === 'number'; }) }; }), d.rows, { height: '55vh', csv: (w.title || 'widget') + '.csv' }); })
            .catch(function (e) { $('pg-dd').innerHTML = '<div class="callout bad">' + esc(String(e.message || e)) + '</div>'; });
    };
    P.editWidget = function (w) {
        var isNew = !w; w = w || { id: uid(), type: 'kpi', title: 'New widget', w: 4, fmt: 'money', sql: '' };
        FL.modal(isNew ? 'Add a widget' : 'Edit widget', '<div class="pg-form"><label>Title <input id="we-t" value="' + esc(w.title || '') + '"></label>' +
            '<label>Type <select id="we-ty">' + TYPES.map(function (t) { return '<option value="' + t[0] + '"' + (w.type === t[0] ? ' selected' : '') + '>' + t[1] + '</option>'; }).join('') + '</select></label>' +
            '<label>Width <select id="we-w">' + [[3, 'quarter'], [4, 'third'], [6, 'half'], [8, 'two thirds'], [12, 'full']].map(function (o) { return '<option value="' + o[0] + '"' + (+w.w === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
            '<label>Numbers as <select id="we-f">' + [['money', 'money (page scale)'], ['pct', 'percent'], ['num', 'plain number']].map(function (o) { return '<option value="' + o[0] + '"' + ((w.fmt || 'money') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
            '<label class="pg-full" id="we-sqlw">SQL <span class="sm muted">— placeholders {PERIODS} {CMP_PERIODS} {COMPANY_FILTER} {LEDGER}; kpi: value (+ compare); charts: label + 1–4 numbers</span><textarea id="we-sql" rows="9" spellcheck="false">' + esc(w.sql || '') + '</textarea></label>' +
            '<label class="pg-full" id="we-mdw">Text (Markdown)<textarea id="we-md" rows="6">' + esc(w.md || '') + '</textarea></label>' +
            '<div class="pg-full" id="we-test"></div></div>',
            '<button class="btn" id="we-try"><i class="fa-solid fa-play"></i> Test</button><button class="btn primary" id="we-ok">' + (isNew ? 'Add' : 'Apply') + '</button>');
        var vis = function () { var t = $('we-ty').value === 'text'; $('we-sqlw').style.display = t ? 'none' : ''; $('we-mdw').style.display = t ? '' : 'none'; };
        $('we-ty').onchange = vis; vis();
        var read = function () { return Object.assign({}, w, { title: $('we-t').value, type: $('we-ty').value, w: +$('we-w').value, fmt: $('we-f').value, sql: $('we-sql').value.trim(), md: $('we-md').value }); };
        $('we-try').onclick = function () { var x = read(); if (x.type === 'text') return; $('we-test').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
            FL.sql(P.fill(x.sql, P.cur), 20).then(function (d) { $('we-test').innerHTML = '<div class="sm pos">✓ ' + d.rows.length + ' row(s): ' + esc(d.columns.join(', ')) + '</div>'; }).catch(function (e) { $('we-test').innerHTML = '<div class="callout bad sm">' + esc(String(e.message || e)) + '</div>'; }); };
        $('we-ok').onclick = function () { var x = read(); if (isNew) P.cur.widgets.push(x); else Object.assign(w, x); FL.closeModal(); P.dirty = true; P.paintHead(); P.paintGrid(); };
    };

    // ── the Copilot designs / changes the page ──
    P.pageJson = function (pg) { return { name: pg.name, widgets: (pg.widgets || []).map(function (w) { var o = { type: w.type, title: w.title, w: w.w, fmt: w.fmt }; if (w.sql) o.sql = w.sql; if (w.md) o.md = w.md; if (w.note) o.note = w.note; return o; }) }; };
    P.designContext = function () {
        var pg = P.cur, seg = FL.segpl && FL.segpl.st && FL.segpl.st.groups && FL.segpl.st.groups[0];
        return { purpose: 'Design a Finance Lens page (My pages)', guide: P.GUIDE, page: P.pageJson(pg),
            parameters_now: { PERIODS: (pg.params.periods || []).join(','), period_names: (pg.params.periods || []).map(P.pname), CMP_PERIODS: P.cmpSeqs(pg).join(','), compare: pg.params.cmp, COMPANY_FILTER: P.fill('{COMPANY_FILTER}', pg), LEDGER: pg.params.ledger },
            hints: { companies: (FL.dims.companies || []).slice(0, 30), extended_segment_in_use: seg ? { column: seg, name: FL.segpl.label(seg) } : null, currency: ((FL.status || {}).meta || {}).currency } };
    };
    P.parse = function (text) {
        var m = /```page\s*([\s\S]*?)```/.exec(text || '') || /```json\s*(\{[\s\S]*?"widgets"[\s\S]*?\})\s*```/.exec(text || '');
        if (!m) return null;
        try { var pg = JSON.parse(m[1]); if (!pg || !Array.isArray(pg.widgets)) return null; pg.widgets.forEach(function (w) { w.id = uid(); if (!w.w) w.w = w.type === 'kpi' ? 3 : 6; }); return pg; } catch (e) { return null; }
    };
    P.design = function (instruction) {
        if (P.busy) { FL.toast('The Copilot is still designing — wait or press Stop', 'info'); return; }
        if (!P.cur) return;
        P.busy = true; P.preview = { pending: true, instruction: instruction, steps: [] }; P.paintPreview();
        var q = 'Change or build the page "' + P.cur.name + '" for the CFO: ' + instruction + '\n\nFollow the design guide in the context. The current page JSON is in the context (empty widgets = start from scratch). Answer with ONE ```page block holding the whole page.';
        FL.call('finAsk', { question: q, history: [], context: JSON.stringify(P.designContext()) }, 11 * 60000, function (msg) { if (msg && P.preview) { P.preview.steps.push(msg); P.paintPreview(); } })
            .then(function (r) { P.preview.pending = false; P.preview.answer = r.answer || ''; P.preview.cost = r.costUsd; P.preview.page = P.parse(r.answer); })
            .catch(function (e) { P.preview.pending = false; P.preview.error = String(e && e.message || e); })
            .then(function () { P.busy = false; P.paintPreview(); });
    };
    P.paintPreview = function () {
        var el = $('pg-ai'), pv = P.preview; if (!el) return;
        if (!pv) { el.innerHTML = ''; return; }
        var steps = pv.steps.length ? '<details class="cop-steps"><summary class="sm muted">' + (pv.pending ? '<i class="fa-solid fa-circle-notch fa-spin"></i> ' + esc(pv.steps[pv.steps.length - 1]).slice(0, 120) : pv.steps.length + ' step(s)') + '</summary>' + pv.steps.map(function (s) { return '<div class="sm">' + esc(s) + '</div>'; }).join('') + '</details>' : '';
        if (pv.pending) { el.innerHTML = '<div class="pg-pv"><div class="sm"><i class="fa-solid fa-circle-notch fa-spin"></i> Designing: ' + esc(pv.instruction) + ' <a id="pg-stop">stop</a></div>' + steps + '</div>'; $('pg-stop').onclick = function () { FL.call('finAskCancel', {}).catch(function () { /* ended */ }); }; return; }
        if (pv.error) { el.innerHTML = '<div class="pg-pv"><div class="callout bad sm">' + esc(pv.error) + '</div><a id="pg-pvx" class="sm">close</a></div>'; $('pg-pvx').onclick = function () { P.preview = null; P.paintPreview(); }; return; }
        var after = String(pv.answer || '').replace(/```page[\s\S]*?```/, '').trim();
        var cur = P.cur.widgets || [], nw = pv.page ? pv.page.widgets : [];
        var titles = function (l) { return l.map(function (w) { return w.title; }); }, added = nw.filter(function (w) { return titles(cur).indexOf(w.title) < 0; }), removed = cur.filter(function (w) { return titles(nw).indexOf(w.title) < 0; });
        el.innerHTML = '<div class="pg-pv">' + steps + (pv.page ? '<div class="row" style="gap:8px;flex-wrap:wrap"><b>Proposed page: ' + esc(pv.page.name || P.cur.name) + '</b><span class="sm muted">' + nw.length + ' widget(s)' + (added.length ? ' · new: ' + esc(titles(added).join(', ')) : '') + (removed.length ? ' · removed: ' + esc(titles(removed).join(', ')) : '') + (pv.cost != null ? ' · $' + pv.cost.toFixed(3) : '') + '</span><span class="grow"></span>' +
            '<button class="btn sm primary" id="pg-apply"><i class="fa-solid fa-check"></i> Apply</button><button class="btn sm" id="pg-pvx">Discard</button></div>' : '<div class="callout warn sm">The Copilot did not return a page this time. <a id="pg-pvx">close</a></div>') +
            (after ? '<div class="cop-md sm">' + FL.copilot.md(after, 'pgpv') + '</div>' : '') + '</div>';
        if ($('pg-apply')) $('pg-apply').onclick = function () { P.apply(pv.page); };
        $('pg-pvx').onclick = function () { P.preview = null; P.paintPreview(); };
    };
    /** Replace the open page's widgets (and name) with a page the Copilot proposed — the CFO still presses Save */
    P.apply = function (pg) {
        if (!pg) return;
        if (!P.cur) { P.newPage(pg).then(function () { FL.show('pages'); }); return; }
        P.cur.widgets = pg.widgets; if (pg.name) P.cur.name = pg.name;
        P.preview = null; P.dirty = true; P.edit = false; $('pg-ask') && ($('pg-ask').value = '');
        if (FL.tab !== 'pages') FL.show('pages'); else P.paint();
        FL.toast('Page updated — press Save to keep it', 'ok');
    };
})();
