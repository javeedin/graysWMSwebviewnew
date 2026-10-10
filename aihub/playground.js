/* AI Hub › Playground: one prompt to several provider/model pairs at once (or through the router), side by side with
   speed, tokens and cost. */
var PG = { res: null, busy: false };
var PG_SAMPLES = [
    ['Explain an error', 'ORA-00904: "INVOICE_AMT": invalid identifier in a query on AP_INVOICES_ALL. What is wrong and how do I fix it?'],
    ['Fusion SQL', 'Write Oracle SQL for Fusion: open sales orders (DOO_HEADERS_ALL) created in the last 7 days with their customer name.'],
    ['Customer note', 'Classify this order note as DELIVERY, BILLING, PRODUCT or OTHER and give one line why: "Pls deliver after 2pm, gate closed in the morning"'],
    ['Translate', 'Translate to English: "Livraison urgente demain matin svp, le client attend la marchandise."']
];
function pgRender() {
    var el = $('page-playground');
    if (AH.need(el)) return;
    AH.loadConfig().then(pgDraw).catch(function (e) { el.innerHTML = '<div class="card err">' + esc(e) + '</div>'; });
}
function pgTargets() {
    var out = [];
    AH.providers.forEach(function (p) { if (p.enabled) (p.models || []).forEach(function (m) { out.push({ provider: p.id, model: m, ready: p.configured }); }); });
    return out;
}
function pgDraw() {
    var el = $('page-playground'), tg = pgTargets(), sel = ls('pg.sel', null), tasks = Object.keys((AH.cfg && AH.cfg.routes) || {});
    if (!sel) sel = tg.slice(0, 3).map(function (t) { return t.provider + '|' + t.model; });
    el.innerHTML = '<h2><i class="fa-solid fa-flask"></i> Playground</h2><p class="lead">Ask the same thing to several models at once. Every answer is priced and logged like any other call.</p>' +
        '<div class="card stack"><div class="row">' + PG_SAMPLES.map(function (s, i) { return '<button class="btn sm" onclick="pgSample(' + i + ')">' + esc(s[0]) + '</button>'; }).join('') + '</div>' +
        '<label class="f">Prompt<textarea id="pg-q" rows="4" placeholder="Ask anything…">' + esc(ls('pg.q', '')) + '</textarea></label>' +
        '<label class="f">System (optional)<input type="text" id="pg-sys" value="' + esc(ls('pg.sys', '')) + '" placeholder="e.g. Answer in two sentences."></label>' +
        '<div class="row"><label class="f">Data class<select id="pg-dc">' + ((AH.cfg && AH.cfg.data_classes) || []).map(function (d) { return '<option' + (d === ls('pg.dc', 'public') ? ' selected' : '') + '>' + d + '</option>'; }).join('') + '</select></label>' +
        '<label class="f">Max tokens<input type="number" id="pg-max" value="' + ls('pg.max', 800) + '" min="50" max="8000" style="width:110px"></label></div>' +
        '<div><b class="sm">Send to</b><div class="targets" style="margin-top:6px">' +
        '<label class="tgt' + (ls('pg.router', false) ? ' on' : '') + '"><input type="checkbox" id="pg-router" ' + (ls('pg.router', false) ? 'checked' : '') + ' onchange="this.parentNode.classList.toggle(\'on\', this.checked)"> <i class="fa-solid fa-route"></i> Router: <select id="pg-task" onclick="event.stopPropagation()">' + tasks.map(function (t) { return '<option>' + t + '</option>'; }).join('') + '</select></label>' +
        (tg.length ? tg.map(function (t) { var k = t.provider + '|' + t.model, on = sel.indexOf(k) >= 0; return '<label class="tgt' + (on ? ' on' : '') + '"' + (t.ready ? '' : ' title="not ready: keys missing"') + '><input type="checkbox" data-t="' + esc(k) + '" ' + (on ? 'checked' : '') + ' onchange="this.parentNode.classList.toggle(\'on\', this.checked)"><span class="dot" style="color:' + AH.provColor(t.provider) + '"></span>' + esc(t.model) + ' <span class="muted">' + esc(t.provider) + '</span></label>'; }).join('') : '<span class="muted sm">Switch a provider on first (Providers).</span>') + '</div></div>' +
        '<div class="row"><button class="btn primary" id="pg-go" onclick="pgRun()"' + (PG.busy ? ' disabled' : '') + '><i class="fa-solid fa-paper-plane"></i> Ask</button><span class="muted sm">Up to 6 at once.</span></div></div>' +
        '<div id="pg-out" style="margin-top:12px"></div>';
    if (PG.res) pgShow();
}
function pgSample(i) { $('pg-q').value = PG_SAMPLES[i][1]; if (i === 1) $('pg-dc').value = 'fusion-data'; }
function pgRun() {
    var q = $('pg-q').value.trim(); if (!q) { toast('Type a prompt', 'err'); return; }
    var picks = Array.prototype.map.call(document.querySelectorAll('[data-t]:checked'), function (i) { var p = i.dataset.t.split('|'); return { provider: p[0], model: p.slice(1).join('|') }; });
    var viaRouter = $('pg-router').checked;
    if (!picks.length && !viaRouter) { toast('Pick at least one model or the router', 'err'); return; }
    lsSet('pg.q', q); lsSet('pg.sys', $('pg-sys').value); lsSet('pg.dc', $('pg-dc').value); lsSet('pg.max', +$('pg-max').value || 800); lsSet('pg.router', viaRouter);
    lsSet('pg.sel', picks.map(function (t) { return t.provider + '|' + t.model; }));
    var base = { messages: [{ role: 'user', content: q }], system: $('pg-sys').value, data_class: $('pg-dc').value, max_tokens: +$('pg-max').value || 800, task: $('pg-task').value };
    PG.busy = true; $('pg-go').disabled = true;
    $('pg-out').innerHTML = '<div class="empty"><i class="fa-solid fa-spinner fa-spin"></i> Asking ' + (picks.length + (viaRouter ? 1 : 0)) + '…</div>';
    var jobs = [];
    if (picks.length) jobs.push(hub('POST', '/v1/compare', Object.assign({ targets: picks.slice(0, 6) }, base)).then(function (r) { return r.results; }));
    if (viaRouter) jobs.push(hub('POST', '/v1/chat', base).then(function (r) { return [Object.assign({ target: { provider: 'router', model: base.task } }, r)]; }, function (e) { return [{ target: { provider: 'router', model: base.task }, ok: false, error: String(e) }]; }));
    Promise.all(jobs).then(function (parts) { PG.res = [].concat.apply([], parts); pgShow(); })
        .catch(function (e) { $('pg-out').innerHTML = '<div class="card err">' + esc(e) + '</div>'; })
        .then(function () { PG.busy = false; if ($('pg-go')) $('pg-go').disabled = false; });
}
function pgShow() {
    var ok = PG.res.filter(function (r) { return r.ok; });
    var fast = ok.length ? Math.min.apply(null, ok.map(function (r) { return r.ms; })) : null, cheap = ok.length ? Math.min.apply(null, ok.map(function (r) { return r.cost; })) : null;
    $('pg-out').innerHTML = '<div class="answers">' + PG.res.map(function (r) {
        var t = r.target || {};
        return '<div class="card ans"><div class="row"><span class="dot" style="color:' + AH.provColor(r.provider || t.provider) + '"></span><b class="mono sm">' + esc(r.model || t.model) + '</b><span class="muted sm">' + esc(t.provider === 'router' ? 'router (' + t.model + ') → ' + (r.provider || '?') : r.provider || t.provider) + '</span></div>' +
            (r.ok ? '<div class="badges"><span class="b' + (r.ms === fast && ok.length > 1 ? ' win' : '') + '">' + r.ms + ' ms</span><span class="b">' + r.tokens_in + ' → ' + r.tokens_out + ' tokens</span><span class="b' + (r.cost === cheap && ok.length > 1 ? ' win' : '') + '">' + money(r.cost) + '</span>' + (r.fallback ? '<span class="b bad">fallback</span>' : '') + '</div>' +
                '<div class="txt">' + esc(r.text) + '</div>' : '<div class="testres bad">' + esc(r.error) + '</div>') + '</div>';
    }).join('') + '</div>';
}
