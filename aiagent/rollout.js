/* AI Agent — roll-out: the evidence (agent evals per model: routing, tool use, safety, cost; answer feedback) and the
   switch WMS_AI_CONTROL.AI_AGENT_MODE (OFF / BETA / PRIMARY, AI admins, reason audited). PRIMARY = the AI Digital
   Employee page points its users here; retiring it is a release decision (Admin › modules). */
AG.showRollout = function () {
    Promise.all([host('agentMode', {}, 20000).catch(function (e) { return { ok: false, error: String(e) }; }), hub('GET', '/agent/evals?limit=12').catch(function () { return []; })]).then(function (r) {
        var m = r[0], runs = r[1], mode = m.mode || 'BETA';
        var modes = [['OFF', 'Hidden — only the AI Digital Employee'], ['BETA', 'Both modules; the AI Agent is marked beta'], ['PRIMARY', 'The AI Digital Employee page sends its users here']];
        var html = '<h4 style="margin-bottom:6px">Roll-out mode</h4>' + (m.ok === false ? '<p class="err sm">' + esc(m.error) + '</p>' : '') +
            '<div class="opts">' + modes.map(function (x) { return '<button class="opt" data-mode="' + x[0] + '"' + (x[0] === mode ? ' style="background:#4f46e5;color:#fff"' : '') + (m.admin ? '' : ' disabled') + ' title="' + esc(x[1]) + '">' + x[0] + '</button>'; }).join('') + '</div>' +
            '<p class="muted sm">' + esc(modes.filter(function (x) { return x[0] === mode; })[0][1]) + (m.by ? ' · set by ' + esc(m.by) + ' ' + esc(m.at || '') : '') + (m.admin ? '' : ' · only AI admins can change it') + '</p>' +
            (m.admin ? '<input type="text" id="ro-reason" placeholder="Reason for a change (audited)" style="width:100%;margin-top:6px">' : '') +
            '<h4 style="margin:16px 0 6px">Agent evals</h4><p class="muted sm" style="margin-bottom:8px">Scripted conversations: does the supervisor pick the right specialist, does it use the right tools in order, does it stay safe (no run without a dry run, no MRA when asked for a status, no data change when asked to delete)? Fixed data, so models compare fairly. ' +
            'Run it on the model you plan to use before switching.</p>' +
            '<div class="row" style="margin-bottom:8px"><span class="sm">Model: <b>' + esc(AG.model ? AG.model.replace('|', ' · ') : 'Auto (router)') + '</b></span><label class="sm row" title="Refusing a delete, reading before MRA … the offline demo planner skips them"><input type="checkbox" id="ro-all" checked> judgement cases (real models)</label><span class="grow"></span>' +
            '<button class="btn primary sm" id="ro-run"><i class="fa-solid fa-play"></i> Run evals</button></div><div id="ro-out"></div>' +
            (runs.length ? '<table class="t" style="margin-top:8px"><thead><tr><th>When</th><th>Model</th><th class="n">Passed</th><th class="n">Routing</th><th class="n">Tools</th><th>Safety</th><th class="n">Cost</th><th></th></tr></thead><tbody>' + runs.map(function (x) {
                return '<tr><td>' + esc(new Date(x.ts * 1000).toLocaleString()) + '</td><td>' + esc(x.provider + (x.model ? ' · ' + x.model : '')) + '</td><td class="n"><b>' + x.passed + '/' + x.total + '</b></td><td class="n">' + Math.round(x.route_acc * 100) + '%</td><td class="n">' +
                    Math.round(x.trajectory_acc * 100) + '%</td><td>' + (x.safety_ok ? '<span class="ok">ok</span>' : '<span class="err">failed</span>') + '</td><td class="n">' + money(x.cost) + '</td><td><a href="#" onclick="AG.evalDetail(' + x.id + ');return false">cases</a></td></tr>';
            }).join('') + '</tbody></table>' : '<p class="muted sm">No eval runs yet.</p>');
        openModal('Roll-out: AI Agent ↔ AI Digital Employee', html);
        document.querySelectorAll('#modal-b .opt[data-mode]').forEach(function (b) {
            b.onclick = function () {
                var reason = ($('ro-reason') || {}).value || '';
                hostOk('agentMode', { set: b.dataset.mode, reason: reason }, 20000).then(function (x) { toast('Mode: ' + x.mode, 'ok'); AG.showRollout(); }).catch(function (e) { toast(String(e), 'err'); });
            };
        });
        $('ro-run').onclick = function () {
            var mb = AG.modelBody() || {};
            $('ro-out').innerHTML = '<div class="muted sm"><i class="fa-solid fa-circle-notch fa-spin"></i> Running the cases… (a real model takes a minute or two)</div>';
            this.disabled = true;
            hub('POST', '/agent/evals/run', { provider: mb.provider || null, model: mb.model || null, include_model_only: $('ro-all').checked ? null : false })
                .then(function (r) { $('ro-out').innerHTML = AG.evalTable(r); $('ro-run').disabled = false; }, function (e) { $('ro-out').innerHTML = '<p class="err sm">' + esc(e) + '</p>'; });
        };
    });
};
AG.evalTable = function (r) {
    return '<div class="card" style="margin-bottom:8px"><b>' + r.passed + '/' + r.total + ' passed</b> · routing ' + Math.round(r.route_acc * 100) + '% · tools ' + Math.round(r.trajectory_acc * 100) + '% · safety ' +
        (r.safety_ok ? '<span class="ok">ok</span>' : '<span class="err">FAILED</span>') + ' · ' + money(r.cost) + '<table class="t" style="margin-top:6px"><tbody>' + (r.cases || []).map(function (c) {
            return '<tr><td>' + (c.pass ? '<span class="ok">✔</span>' : '<span class="err">✖</span>') + '</td><td><b>' + esc(c.id) + '</b>' + (c.model_only ? ' <span class="muted sm">judgement</span>' : '') + '<div class="muted sm">' + esc(c.question) + '</div></td><td class="sm">' +
                esc(c.route || '') + '<div class="mono" style="font-size:.68rem">' + esc((c.called || []).join(' › ')) + '</div>' + (c.forbidden && c.forbidden.length ? '<div class="err sm">forbidden: ' + esc(c.forbidden.join(', ')) + '</div>' : '') +
                (c.error ? '<div class="err sm">' + esc(c.error) + '</div>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
};
AG.evalDetail = function (id) { hub('GET', '/agent/evals/' + id).then(function (r) { openModal('Eval run · ' + r.provider + (r.model ? ' · ' + r.model : ''), AG.evalTable(r)); }); };
