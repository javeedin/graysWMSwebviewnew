/* AI Hub › Router (tasks → ordered candidates, data class per task, monthly budget, prices) and Usage (ledger). */
var RT = { draft: null, preview: {} };
function rtRender() {
    var el = $('page-router');
    if (AH.need(el)) return;
    AH.loadConfig(true).then(function () {
        RT.draft = JSON.parse(JSON.stringify({ routes: AH.cfg.routes, task_data_class: AH.cfg.task_data_class, prices: AH.cfg.prices, budget_month_usd: AH.cfg.budget_month_usd }));
        RT.preview = {};
        rtDraw();
        Object.keys(RT.draft.routes).forEach(rtPreview);
    }).catch(function (e) { el.innerHTML = '<div class="card err">' + esc(e) + '</div>'; });
}
function rtDraw() {
    var el = $('page-router'), d = RT.draft, dcs = AH.cfg.data_classes || [];
    var provOpts = function (cur) { return AH.providers.map(function (p) { return '<option value="' + p.id + '"' + (p.id === cur ? ' selected' : '') + '>' + esc(p.label) + '</option>'; }).join(''); };
    var modelIn = function (task, i, c) {
        var p = AH.providers.filter(function (x) { return x.id === c.provider; })[0], ms = (p && p.models) || [];
        if (ms.length && (ms.indexOf(c.model) >= 0 || !c.model)) return '<select onchange="rtSet(\'' + task + '\',' + i + ',\'model\',this.value)">' + ['<option value=""></option>'].concat(ms.map(function (m) { return '<option' + (m === c.model ? ' selected' : '') + '>' + esc(m) + '</option>'; })).join('') + '</select>';
        return '<input type="text" value="' + esc(c.model) + '" placeholder="model id" onchange="rtSet(\'' + task + '\',' + i + ',\'model\',this.value)">';
    };
    el.innerHTML = '<h2><i class="fa-solid fa-route"></i> Router</h2><p class="lead">Each task names the models to try, in order. The first one that is switched on, has its keys, may see the task\'s data class and answers — wins. A refusal or an error moves on to the next.</p>' +
        '<div class="grid g2">' + Object.keys(d.routes).map(function (task) {
            var pv = RT.preview[task];
            return '<div class="card route"><div class="row"><h3 style="margin:0"><i class="fa-solid fa-signs-post"></i> ' + esc(task) + '</h3><span class="grow"></span><label class="sm row">data <select onchange="RT.draft.task_data_class[\'' + task + '\']=this.value;rtPreview(\'' + task + '\')">' +
                dcs.map(function (x) { return '<option' + ((d.task_data_class[task] || 'internal') === x ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select></label>' +
                (['default', 'fusion_sql', 'pipeline_doctor', 'cheap'].indexOf(task) < 0 ? '<button class="icon" title="Remove task" onclick="delete RT.draft.routes[\'' + task + '\'];rtDraw()"><i class="fa-solid fa-trash"></i></button>' : '') + '</div>' +
                d.routes[task].map(function (c, i) {
                    var skip = pv && pv.skipped.filter(function (s) { return s.provider === c.provider && s.model === c.model; })[0], win = pv && pv.use[0] && pv.use[0].provider === c.provider && pv.use[0].model === c.model;
                    return '<div class="cand' + (skip ? ' skip' : '') + '"><span class="n">' + (i + 1) + '</span><select onchange="rtSet(\'' + task + '\',' + i + ',\'provider\',this.value)">' + provOpts(c.provider) + '</select>' + modelIn(task, i, c) +
                        (win ? '<span class="b win">answers now</span>' : skip ? '<span class="why-skip">' + esc(skip.reason) + '</span>' : '') + '<span class="grow"></span>' +
                        '<button class="icon" title="Up" onclick="rtMove(\'' + task + '\',' + i + ',-1)"><i class="fa-solid fa-arrow-up"></i></button><button class="icon" title="Remove" onclick="RT.draft.routes[\'' + task + '\'].splice(' + i + ',1);rtDraw()"><i class="fa-solid fa-xmark"></i></button></div>';
                }).join('') + '<div><button class="btn sm" onclick="RT.draft.routes[\'' + task + '\'].push({provider:\'demo\',model:\'demo\'});rtDraw()"><i class="fa-solid fa-plus"></i> Add a fallback</button></div></div>';
        }).join('') + '</div>' +
        '<div class="row" style="margin:10px 0"><input type="text" id="rt-new" placeholder="new task name, e.g. order_notes"><button class="btn" onclick="rtAddTask()"><i class="fa-solid fa-plus"></i> Add task</button></div>' +
        '<div class="grid g2"><div class="card"><h3><i class="fa-solid fa-wallet"></i> Monthly budget</h3><div class="row"><span>$</span><input type="number" min="0" step="5" value="' + d.budget_month_usd + '" onchange="RT.draft.budget_month_usd=+this.value" style="width:120px"><span class="muted sm">When this month\'s spend reaches it, paid models are skipped (free / demo still answer). 0 = no limit.</span></div></div>' +
        '<div class="card"><h3><i class="fa-solid fa-tags"></i> Prices (USD per million tokens)</h3><p class="muted sm" style="margin-bottom:6px">Claude list prices are filled in; set your Bedrock / NVIDIA contract prices (regional Bedrock endpoints cost about 10 % more).</p>' +
        '<table class="t"><tr><th>Model</th><th class="n">Input</th><th class="n">Output</th><th></th></tr>' + Object.keys(d.prices).sort().map(function (m) {
            return '<tr><td class="mono">' + esc(m) + '</td><td class="n"><input type="number" step="0.01" min="0" value="' + d.prices[m][0] + '" style="width:80px" onchange="RT.draft.prices[\'' + esc(m) + '\'][0]=+this.value"></td><td class="n"><input type="number" step="0.01" min="0" value="' + d.prices[m][1] + '" style="width:80px" onchange="RT.draft.prices[\'' + esc(m) + '\'][1]=+this.value"></td><td><button class="icon" onclick="delete RT.draft.prices[\'' + esc(m) + '\'];rtDraw()"><i class="fa-solid fa-xmark"></i></button></td></tr>';
        }).join('') + '</table><div class="row" style="margin-top:6px"><input type="text" id="rt-pm" placeholder="model id"><button class="btn sm" onclick="rtAddPrice()"><i class="fa-solid fa-plus"></i> Add price</button></div></div></div>' +
        '<div class="row" style="margin-top:12px"><button class="btn primary" onclick="rtSave()"><i class="fa-solid fa-floppy-disk"></i> Save router</button><button class="btn" onclick="rtRender()">Undo changes</button></div>';
}
function rtSet(task, i, k, v) { RT.draft.routes[task][i][k] = v; if (k === 'provider') { var p = AH.providers.filter(function (x) { return x.id === v; })[0]; RT.draft.routes[task][i].model = (p && p.models && p.models[0]) || ''; } rtDraw(); rtPreview(task); }
function rtMove(task, i, d) { var r = RT.draft.routes[task]; if (i + d < 0) return; var x = r.splice(i, 1)[0]; r.splice(i + d, 0, x); rtDraw(); }
function rtAddTask() { var n = ($('rt-new').value || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'); if (!n) return; RT.draft.routes[n] = [{ provider: 'demo', model: 'demo' }]; RT.draft.task_data_class[n] = 'internal'; rtDraw(); }
function rtAddPrice() { var m = ($('rt-pm').value || '').trim(); if (!m) return; RT.draft.prices[m] = [0, 0]; rtDraw(); }
/** Who answers now (saved provider state, this draft's order is not saved yet → preview of the saved route). */
function rtPreview(task) {
    hub('POST', '/v1/route-preview', { messages: [{ role: 'user', content: '.' }], task: task, data_class: RT.draft.task_data_class[task] })
        .then(function (r) { RT.preview[task] = r; rtDraw(); }).catch(function () { });
}
function rtSave() {
    hub('PUT', '/routes', RT.draft).then(function () { toast('Router saved', 'ok'); return AH.loadConfig(true); }).then(function () { Object.keys(RT.draft.routes).forEach(rtPreview); })
        .catch(function (e) { toast(String(e), 'err'); });
}

// ── Usage ──────────────────────────────────────────────────────
var US = { chart: null, days: 30 };
function usRender() {
    var el = $('page-usage');
    if (AH.need(el)) return;
    Promise.all([hub('GET', '/usage?days=' + US.days), hub('GET', '/health')]).then(function (r) { usDraw(r[0], r[1]); }).catch(function (e) { el.innerHTML = '<div class="card err">' + esc(e) + '</div>'; });
}
function usDraw(u, h) {
    var el = $('page-usage'), calls = u.by_model.reduce(function (a, r) { return a + r.calls; }, 0), oks = u.by_model.reduce(function (a, r) { return a + (r.ok || 0); }, 0),
        fb = u.by_model.reduce(function (a, r) { return a + (r.fallbacks || 0); }, 0), pct = h.budget ? Math.min(100, Math.round(u.month_cost / h.budget * 100)) : 0;
    var days = [], provs = [];
    u.by_day.forEach(function (r) { if (days.indexOf(r.day) < 0) days.push(r.day); if (provs.indexOf(r.provider) < 0) provs.push(r.provider); });
    var order = ['bedrock', 'bedrock-converse', 'claude-aws', 'anthropic', 'nvidia', 'demo'];
    provs.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
    el.innerHTML = '<h2><i class="fa-solid fa-coins"></i> Usage <select style="margin-left:auto" onchange="US.days=+this.value;usRender()">' + [7, 30, 90].map(function (d) { return '<option value="' + d + '"' + (d === US.days ? ' selected' : '') + '>last ' + d + ' days</option>'; }).join('') + '</select></h2>' +
        '<p class="lead">Every model call through the hub — also written to WMS_AI_AUDIT (source AIHUB) with model, tokens and cost.</p>' +
        '<div class="grid g4"><div class="card kpi"><span>This month</span><b>' + money(u.month_cost) + '</b><div class="meter ' + (pct >= 100 ? 'bad' : pct >= 80 ? 'warn' : '') + '"><i style="width:' + pct + '%"></i></div><span>' + pct + ' % of the $' + (h.budget || 0) + ' budget</span></div>' +
        '<div class="card kpi"><span>Calls</span><b>' + calls.toLocaleString() + '</b><span>' + US.days + ' days</span></div>' +
        '<div class="card kpi"><span>Answered</span><b>' + (calls ? Math.round(oks / calls * 100) : 0) + ' %</b><span>' + (calls - oks) + ' failed attempts</span></div>' +
        '<div class="card kpi"><span>Saved by fallback</span><b>' + fb + '</b><span>answered by a later candidate</span></div></div>' +
        '<div class="card" style="margin-top:12px"><h3><i class="fa-solid fa-chart-column"></i> Cost per day by provider</h3>' + (days.length ? '<div style="height:260px"><canvas id="us-chart" aria-label="Cost per day by provider, stacked"></canvas></div>' : '<div class="empty">No calls yet.</div>') +
        (days.length ? '<details style="margin-top:8px"><summary class="sm muted">Show as table</summary><table class="t"><tr><th>Day</th>' + provs.map(function (p) { return '<th class="n">' + esc(AH.provName(p)) + '</th>'; }).join('') + '</tr>' +
            days.map(function (d) { return '<tr><td>' + d + '</td>' + provs.map(function (p) { var r = u.by_day.filter(function (x) { return x.day === d && x.provider === p; })[0]; return '<td class="n">' + (r ? money(r.cost) + ' · ' + r.calls : '') + '</td>'; }).join('') + '</tr>'; }).join('') + '</table></details>' : '') + '</div>' +
        '<div class="grid g2" style="margin-top:12px"><div class="card"><h3>By model</h3><table class="t"><tr><th>Provider</th><th>Model</th><th class="n">Calls</th><th class="n">OK</th><th class="n">Avg ms</th><th class="n">Tokens in/out</th><th class="n">Cost</th></tr>' +
        u.by_model.map(function (r) { return '<tr><td><span class="dot" style="display:inline-block;color:' + AH.provColor(r.provider) + '"></span> ' + esc(r.provider) + '</td><td class="mono">' + esc(r.model) + '</td><td class="n">' + r.calls + '</td><td class="n">' + (r.ok || 0) + '</td><td class="n">' + (r.avg_ms || '') + '</td><td class="n">' + (r.tokens_in || 0) + ' / ' + (r.tokens_out || 0) + '</td><td class="n">' + money(r.cost) + '</td></tr>'; }).join('') + '</table></div>' +
        '<div class="card"><h3>By task</h3><table class="t"><tr><th>Task</th><th class="n">Calls</th><th class="n">OK</th><th class="n">Cost</th></tr>' + u.by_task.map(function (r) { return '<tr><td>' + esc(r.task) + '</td><td class="n">' + r.calls + '</td><td class="n">' + (r.ok || 0) + '</td><td class="n">' + money(r.cost) + '</td></tr>'; }).join('') + '</table></div></div>' +
        '<div class="card" style="margin-top:12px"><h3>Latest calls</h3><table class="t"><tr><th>When</th><th>User</th><th>Task</th><th>Provider / model</th><th class="n">ms</th><th class="n">Cost</th><th>Result</th></tr>' +
        u.recent.map(function (r) { return '<tr><td>' + new Date(r.ts * 1000).toLocaleString() + '</td><td>' + esc(r.app_user || '') + '</td><td>' + esc(r.task) + '</td><td class="mono">' + esc(r.provider + ' / ' + r.model) + '</td><td class="n">' + r.ms + '</td><td class="n">' + money(r.cost) + '</td><td>' + (r.ok ? '<span class="ok">✓</span>' + (r.fallback ? ' <span class="b">fallback</span>' : '') : '<span class="err" title="' + esc(r.error) + '">✗ ' + esc(String(r.error || '').slice(0, 60)) + '</span>') + '</td></tr>'; }).join('') + '</table></div>';
    if (US.chart) { US.chart.destroy(); US.chart = null; }
    if (days.length && window.Chart) {
        US.chart = new Chart($('us-chart'), {
            type: 'bar',
            data: { labels: days, datasets: provs.map(function (p) { return { label: AH.provName(p), data: days.map(function (d) { var r = u.by_day.filter(function (x) { return x.day === d && x.provider === p; })[0]; return r ? r.cost : 0; }),
                backgroundColor: AH.provHex(p), borderColor: '#ffffff', borderWidth: { top: 2 }, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 28 }; }) },
            options: { maintainAspectRatio: false, plugins: { legend: { position: 'top', align: 'start', labels: { boxWidth: 10, boxHeight: 10, color: '#334155' } },
                tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + money(c.parsed.y); } } } },
                scales: { x: { stacked: true, grid: { display: false }, ticks: { color: '#64748b' } }, y: { stacked: true, grid: { color: '#f1f5f9' }, border: { display: false }, ticks: { color: '#64748b', callback: function (v) { return money(v); } } } } }
        });
    }
}
