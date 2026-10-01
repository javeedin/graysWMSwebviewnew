/* AI Hub › Evals: the team's verified Fusion questions (Knowledge tab, kind EXAMPLE, APPROVED) through each model.
   Each model writes SQL; both its SQL and the verified SQL run on Fusion (read-only runner) and the RESULTS are
   compared - not the text. Scoreboard: accuracy, speed, cost per correct answer. Saved in WMS_AIHUB_EVALS. */
var EV = { cases: [], sel: {}, run: null, history: [], busy: false, stop: false };
var EV_SYSTEM = 'FUSION_SQL\nYou write ONE read-only Oracle SQL query for Oracle Fusion Cloud Applications (the Fusion database: tables such as ' +
    'DOO_HEADERS_ALL, AP_INVOICES_ALL, HZ_PARTIES, EGP_SYSTEM_ITEMS_B …) that answers the question exactly. Return only one ```sql block, no explanation, no trailing semicolon.';

function evRender() {
    var el = $('page-evals');
    if (AH.need(el)) return;
    el.innerHTML = '<div class="empty"><i class="fa-solid fa-spinner fa-spin"></i> Loading verified questions…</div>';
    Promise.all([AH.loadConfig(), evEnsure().then(function () { return Promise.all([evLoadCases(), evLoadHistory()]); })]).then(evDraw)
        .catch(function (e) { el.innerHTML = '<div class="card err">' + esc(e) + '</div>'; });
}
function evEnsure() {
    return rows("SELECT table_name FROM user_tables WHERE table_name = 'WMS_AIHUB_EVALS'", 1).then(function (r) {
        if (r.length) return;
        return dbWrite('CREATE TABLE wms_aihub_evals (eval_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, run_key VARCHAR2(40) NOT NULL, run_date DATE DEFAULT SYSDATE, ' +
            'run_by VARCHAR2(120), instance VARCHAR2(10), fact_id NUMBER, question VARCHAR2(2000), provider VARCHAR2(40), model VARCHAR2(200), verdict VARCHAR2(20), ' +
            'ms NUMBER, cost NUMBER, rows_expected NUMBER, rows_got NUMBER, sql_text VARCHAR2(4000), error_text VARCHAR2(1000))');
    });
}
function evLoadCases() {
    return rows("SELECT fact_id, fact, example_sql, instance FROM wms_fusion_knowledge WHERE kind = 'EXAMPLE' AND status = 'APPROVED' AND example_sql IS NOT NULL ORDER BY fact_id DESC", 200)
        .then(function (r) { EV.cases = r; if (!Object.keys(EV.sel).length) r.slice(0, 10).forEach(function (c) { EV.sel[c.FACT_ID] = 1; }); })
        .catch(function () { EV.cases = []; });
}
function evLoadHistory() {
    return rows("SELECT run_key, TO_CHAR(MIN(run_date), 'YYYY-MM-DD HH24:MI') AS at, MIN(run_by) AS run_by, MIN(instance) AS instance, COUNT(DISTINCT fact_id) AS qs, " +
        "COUNT(DISTINCT provider || '/' || model) AS models, SUM(CASE WHEN verdict = 'MATCH' THEN 1 ELSE 0 END) AS hits, COUNT(*) AS n FROM wms_aihub_evals GROUP BY run_key ORDER BY MIN(run_date) DESC", 30)
        .then(function (r) { EV.history = r; }).catch(function () { EV.history = []; });
}
function evDraw() {
    var el = $('page-evals'), tg = pgTargets(), sel = ls('ev.sel', null) || tg.slice(0, 2).map(function (t) { return t.provider + '|' + t.model; });
    var n = Object.keys(EV.sel).filter(function (k) { return EV.sel[k]; }).length;
    el.innerHTML = '<h2><i class="fa-solid fa-ranking-star"></i> Evals — which model gets OUR Fusion questions right?</h2>' +
        '<p class="lead">Questions come from Fusion SQL › Knowledge (verified examples marked 👍 Correct). Each model writes SQL; both its SQL and the verified one run on Fusion and the results are compared. Read-only, on the pod you pick.</p>' +
        '<div class="grid g2"><div class="card stack"><div class="row"><h3 style="margin:0">Questions (' + n + ' of ' + EV.cases.length + ')</h3><span class="grow"></span>' +
        '<button class="btn sm" onclick="EV.cases.forEach(function(c){EV.sel[c.FACT_ID]=1});evDraw()">All</button><button class="btn sm" onclick="EV.sel={};evDraw()">None</button></div>' +
        (EV.cases.length ? '<div style="max-height:260px;overflow:auto">' + EV.cases.map(function (c) { return '<label class="row sm" style="padding:3px 0;align-items:flex-start"><input type="checkbox" ' + (EV.sel[c.FACT_ID] ? 'checked' : '') + ' onchange="EV.sel[' + c.FACT_ID + ']=this.checked?1:0"> <span>' + esc(c.FACT) + '</span></label>'; }).join('') + '</div>'
            : '<div class="empty">No verified examples yet. In Fusion SQL › Ask AI, press 👍 Correct on a good answer — it becomes a test question here.</div>') + '</div>' +
        '<div class="card stack"><h3 style="margin:0">Models</h3><div class="targets">' + (tg.length ? tg.map(function (t) { var k = t.provider + '|' + t.model, on = sel.indexOf(k) >= 0; return '<label class="tgt' + (on ? ' on' : '') + '"><input type="checkbox" data-ev="' + esc(k) + '" ' + (on ? 'checked' : '') + ' onchange="this.parentNode.classList.toggle(\'on\', this.checked)"><span class="dot" style="color:' + AH.provColor(t.provider) + '"></span>' + esc(t.model) + '</label>'; }).join('') : '<span class="muted sm">Switch a provider on first.</span>') + '</div>' +
        '<div class="row"><label class="f">Fusion pod<select id="ev-pod"><option' + (ls('pod', 'PROD') === 'PROD' ? ' selected' : '') + '>PROD</option><option' + (ls('pod', 'PROD') === 'TEST' ? ' selected' : '') + '>TEST</option></select></label>' +
        '<label class="row sm"><input type="checkbox" id="ev-hints" ' + (ls('ev.hints', true) ? 'checked' : '') + '> tell the model which tables the answer uses</label></div>' +
        '<div class="row"><button class="btn primary" id="ev-go" onclick="evRun()"' + (EV.busy ? ' disabled' : '') + '><i class="fa-solid fa-play"></i> Run eval</button>' + (EV.busy ? '<button class="btn danger" onclick="EV.stop=true">Stop</button>' : '') +
        '<span class="muted sm" id="ev-prog"></span></div></div></div>' +
        '<div id="ev-out" style="margin-top:12px"></div>' +
        '<div class="card" style="margin-top:12px"><h3><i class="fa-solid fa-clock-rotate-left"></i> Earlier runs</h3>' + (EV.history.length ? '<table class="t"><tr><th>When</th><th>By</th><th>Pod</th><th class="n">Questions</th><th class="n">Models</th><th class="n">Correct</th><th></th></tr>' +
            EV.history.map(function (h) { return '<tr><td>' + esc(h.AT) + '</td><td>' + esc(h.RUN_BY) + '</td><td>' + esc(h.INSTANCE) + '</td><td class="n">' + h.QS + '</td><td class="n">' + h.MODELS + '</td><td class="n">' + h.HITS + ' / ' + h.N + '</td><td><button class="btn sm" onclick="evOpen(\'' + esc(h.RUN_KEY) + '\')">Open</button></td></tr>'; }).join('') + '</table>' : '<div class="empty">No runs yet.</div>') + '</div>';
    if (EV.run) evShow();
}
function evTables(sql) {
    var out = [], re = /\b(?:from|join)\s+([a-z0-9_$#.]+)/gi, m;
    while ((m = re.exec(sql))) { var t = m[1].split('.').pop().toUpperCase(); if (out.indexOf(t) < 0 && !/^(DUAL|SELECT)$/.test(t)) out.push(t); }
    return out;
}
function evSql(text) { var m = /```(?:sql)?\s*([\s\S]*?)```/i.exec(text || ''); var s = (m ? m[1] : '').trim().replace(/;\s*$/, ''); return /^\s*(select|with)\b/i.test(s) ? s : null; }
function evNorm(v) { if (v == null) return ''; var s = String(v).trim(); if (/^-?\d+(\.\d+)?(e-?\d+)?$/i.test(s)) return String(Math.round(parseFloat(s) * 1e6) / 1e6); return s; }
function evSig(r, cols) { var c = cols || Object.keys(r); return c.map(function (k) { return evNorm(r[k]); }).sort().join('\u0001'); }
/** Result comparison: same rows (column order / names ignored), else the expected columns picked by name, else row count. */
function evCompare(exp, got) {
    var e = exp.rows.map(function (r) { return evSig(r); }).sort(), g = got.rows.map(function (r) { return evSig(r); }).sort();
    if (e.length === g.length && e.join('\n') === g.join('\n')) return 'MATCH';
    var ec = exp.columns.map(function (c) { return String(c.name || c).toUpperCase(); }), gk = got.rows[0] ? Object.keys(got.rows[0]) : [];
    var map = ec.map(function (c) { return gk.filter(function (k) { return k.toUpperCase() === c; })[0]; });
    if (map.every(Boolean) && e.length === got.rows.length && got.rows.map(function (r) { return evSig(r, map); }).sort().join('\n') === e.join('\n')) return 'MATCH';
    return e.length === g.length ? 'ROWS' : 'WRONG';
}
function evRun() {
    var cases = EV.cases.filter(function (c) { return EV.sel[c.FACT_ID]; });
    var targets = Array.prototype.map.call(document.querySelectorAll('[data-ev]:checked'), function (i) { var p = i.dataset.ev.split('|'); return { provider: p[0], model: p.slice(1).join('|') }; });
    if (!cases.length || !targets.length) { toast('Pick questions and at least one model', 'err'); return; }
    var pod = $('ev-pod').value, hints = $('ev-hints').checked;
    lsSet('pod', pod); lsSet('ev.hints', hints); lsSet('ev.sel', targets.map(function (t) { return t.provider + '|' + t.model; }));
    EV.run = { key: 'EV' + new Date().toISOString().replace(/\D/g, '').slice(0, 14), pod: pod, cases: cases, targets: targets, cells: {}, expected: {} };
    EV.busy = true; EV.stop = false; evDraw();
    var jobs = [];
    cases.forEach(function (c) { targets.forEach(function (t) { jobs.push({ c: c, t: t }); }); });
    var done = 0, total = jobs.length;
    var expected = function (c) {
        if (!EV.run.expected[c.FACT_ID]) EV.run.expected[c.FACT_ID] = fusion(c.EXAMPLE_SQL, 200, pod).catch(function (e) { return { error: String(e) }; });
        return EV.run.expected[c.FACT_ID];
    };
    var one = function (j) {
        var key = j.c.FACT_ID + '|' + j.t.provider + '|' + j.t.model, cell = EV.run.cells[key] = { verdict: 'RUN' };
        evShow();
        var q = 'QUESTION: ' + j.c.FACT + (hints ? '\nTables you will need: ' + evTables(j.c.EXAMPLE_SQL).join(', ') : '');
        return hub('POST', '/v1/chat', { messages: [{ role: 'user', content: q }], system: EV_SYSTEM, task: 'fusion_sql', provider: j.t.provider, model: j.t.model, fallback: false, max_tokens: 2500 }).then(function (r) {
            if (!r.ok) throw r.error;
            cell.ms = r.ms; cell.cost = r.cost; cell.sql = evSql(r.text);
            if (!cell.sql) { cell.verdict = 'NO_SQL'; cell.error = r.text.slice(0, 300); return; }
            return Promise.all([expected(j.c), fusion(cell.sql, 200, pod).catch(function (e) { return { error: String(e) }; })]).then(function (x) {
                if (x[0].error) { cell.verdict = 'ERROR'; cell.error = 'Verified SQL failed: ' + x[0].error; return; }
                cell.rowsExp = x[0].rows.length;
                if (x[1].error) { cell.verdict = 'ERROR'; cell.error = x[1].error; return; }
                cell.rowsGot = x[1].rows.length; cell.verdict = evCompare(x[0], x[1]);
            });
        }).catch(function (e) { cell.verdict = 'ERROR'; cell.error = String(e); }).then(function () {
            done++; if ($('ev-prog')) $('ev-prog').textContent = done + ' / ' + total;
            evShow();
            return dbWrite('INSERT INTO wms_aihub_evals (run_key, run_by, instance, fact_id, question, provider, model, verdict, ms, cost, rows_expected, rows_got, sql_text, error_text) VALUES (' +
                [vlit(EV.run.key, 40), vlit(appUser(), 120), vlit(pod, 10), j.c.FACT_ID, vlit(j.c.FACT, 2000), vlit(j.t.provider, 40), vlit(j.t.model, 200), vlit(cell.verdict, 20),
                    cell.ms || 'NULL', cell.cost != null ? cell.cost : 'NULL', cell.rowsExp != null ? cell.rowsExp : 'NULL', cell.rowsGot != null ? cell.rowsGot : 'NULL', vlit(cell.sql, 4000), vlit(cell.error, 1000)].join(', ') + ')').catch(function () { });
        });
    };
    var i = 0, worker = function () { if (EV.stop || i >= jobs.length) return Promise.resolve(); var j = jobs[i++]; return one(j).then(worker); };
    Promise.all([worker(), worker()]).then(function () { EV.busy = false; toast(EV.stop ? 'Eval stopped' : 'Eval finished', 'ok'); return evLoadHistory(); }).then(evDraw);
}
function evShow() {
    var R = EV.run, out = $('ev-out'); if (!R || !out) return;
    var icon = { MATCH: '✓', ROWS: '≈', WRONG: '✗', ERROR: '⚠', NO_SQL: '∅', RUN: '…' };
    var board = R.targets.map(function (t) {
        var cs = R.cases.map(function (c) { return R.cells[c.FACT_ID + '|' + t.provider + '|' + t.model]; }).filter(function (x) { return x && x.verdict !== 'RUN'; });
        var hit = cs.filter(function (x) { return x.verdict === 'MATCH'; }).length, cost = cs.reduce(function (a, x) { return a + (x.cost || 0); }, 0), ms = cs.filter(function (x) { return x.ms; });
        return { t: t, n: cs.length, hit: hit, acc: cs.length ? hit / cs.length : 0, cost: cost, ms: ms.length ? Math.round(ms.reduce(function (a, x) { return a + x.ms; }, 0) / ms.length) : null };
    }).sort(function (a, b) { return b.acc - a.acc || a.cost - b.cost; });
    out.innerHTML = '<div class="grid g2"><div class="card"><h3><i class="fa-solid fa-trophy"></i> Scoreboard</h3><table class="t"><tr><th>Model</th><th>Accuracy</th><th class="n">Correct</th><th class="n">Avg ms</th><th class="n">Cost</th><th class="n">Per correct</th></tr>' +
        board.map(function (b, i) { return '<tr><td><span class="dot" style="display:inline-block;color:' + AH.provColor(b.t.provider) + '"></span> <b class="mono">' + esc(b.t.model) + '</b>' + (i === 0 && b.hit ? ' <span class="b win">best</span>' : '') + '</td><td style="min-width:120px"><div class="meter"><i style="width:' + Math.round(b.acc * 100) + '%"></i></div><span class="sm">' + Math.round(b.acc * 100) + ' %</span></td>' +
            '<td class="n">' + b.hit + ' / ' + b.n + '</td><td class="n">' + (b.ms || '') + '</td><td class="n">' + money(b.cost) + '</td><td class="n">' + (b.hit ? money(b.cost / b.hit) : '—') + '</td></tr>'; }).join('') + '</table>' +
        '<p class="muted sm" style="margin-top:6px">✓ same result · ≈ same row count, other values · ✗ wrong · ⚠ error · ∅ no SQL. Click a cell to see the SQL.</p></div>' +
        '<div class="card" style="overflow:auto"><h3><i class="fa-solid fa-table-cells"></i> Question × model</h3><table class="t matrix"><tr><th>Question</th>' + R.targets.map(function (t) { return '<th class="mono sm">' + esc(t.model) + '</th>'; }).join('') + '</tr>' +
        R.cases.map(function (c) { return '<tr><td class="sm">' + esc(c.FACT) + '</td>' + R.targets.map(function (t) { var k = c.FACT_ID + '|' + t.provider + '|' + t.model, x = R.cells[k]; return '<td class="cell v-' + (x ? x.verdict : '') + '" style="cursor:pointer" title="' + esc(x ? x.verdict + (x.error ? ': ' + x.error : '') : 'waiting') + '" onclick="evCell(\'' + esc(k) + '\')">' + (x ? (x.verdict === 'RUN' ? '<i class="fa-solid fa-spinner fa-spin"></i>' : icon[x.verdict]) : '·') + '</td>'; }).join('') + '</tr>'; }).join('') + '</table></div></div>';
}
function evCell(k) {
    var x = EV.run && EV.run.cells[k]; if (!x) return;
    var c = EV.run.cases.filter(function (c) { return String(c.FACT_ID) === k.split('|')[0]; })[0];
    openModal(x.verdict + ' — ' + k.split('|').slice(2).join('|'), '<p class="sm"><b>' + esc(c ? c.FACT : '') + '</b></p>' + (x.error ? '<p class="err sm" style="margin:8px 0">' + esc(x.error) + '</p>' : '') +
        '<div class="diff" style="margin-top:8px"><div><b class="sm">Model</b><pre class="out">' + esc(x.sql || '(none)') + '</pre><span class="sm muted">' + (x.rowsGot != null ? x.rowsGot + ' rows' : '') + '</span></div>' +
        '<div><b class="sm">Verified</b><pre class="out">' + esc(c ? c.EXAMPLE_SQL : '') + '</pre><span class="sm muted">' + (x.rowsExp != null ? x.rowsExp + ' rows' : '') + '</span></div></div>');
}
function evOpen(key) {
    rows("SELECT fact_id, question, provider, model, verdict, ms, cost, rows_expected, rows_got, sql_text, error_text, instance FROM wms_aihub_evals WHERE run_key = " + lit(key) + " ORDER BY eval_id", 2000).then(function (r) {
        var cases = [], targets = [], cells = {};
        r.forEach(function (x) {
            if (!cases.some(function (c) { return c.FACT_ID === x.FACT_ID; })) cases.push({ FACT_ID: x.FACT_ID, FACT: x.QUESTION, EXAMPLE_SQL: (EV.cases.filter(function (c) { return c.FACT_ID === x.FACT_ID; })[0] || {}).EXAMPLE_SQL });
            if (!targets.some(function (t) { return t.provider === x.PROVIDER && t.model === x.MODEL; })) targets.push({ provider: x.PROVIDER, model: x.MODEL });
            cells[x.FACT_ID + '|' + x.PROVIDER + '|' + x.MODEL] = { verdict: x.VERDICT, ms: +x.MS || null, cost: +x.COST || 0, rowsExp: x.ROWS_EXPECTED, rowsGot: x.ROWS_GOT, sql: x.SQL_TEXT, error: x.ERROR_TEXT };
        });
        EV.run = { key: key, pod: r[0] && r[0].INSTANCE, cases: cases, targets: targets, cells: cells, expected: {} };
        evShow(); $('ev-out').scrollIntoView({ behavior: 'smooth' });
    }).catch(function (e) { toast(String(e), 'err'); });
}
