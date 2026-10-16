/* AI Agent — the AI Digital Employee's abilities in the agent (page side).
   Host tools (wms_sql, fusion_call, ords_read, device, db_write, wms_job, email, save_report, dll, model_tool) run in C#
   (Form1_AiAgentAide.cs) with the same executors and policy keys as the AI Digital Employee. Here: the interactive grid,
   the API form (the AIDE's api-catalog.js: WMS_API_CATALOG, apiCatalogById, buildApiRequest), the Daily Tasks tools,
   the LOCAL-lane job runner (the AIDE's local-jobs.js) and the confirm-card previews of the write tools.
   Both AIDE scripts call sendMessageToCSharp(msg, cb) / currentInstance() / appUserName() — provided here. */

// ── what the AIDE scripts expect from their page ──
var _smPending = {};
window.sendMessageToCSharp = function (msg, cb) {
    if (!hasHost()) { if (cb) cb('Open this page inside the Gray\'s WMS app.'); return; }
    var id = 'sm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    if (cb) _smPending[id] = cb;
    window.chrome.webview.postMessage(Object.assign({ requestId: id, appUser: appUser() }, msg));
};
if (hasHost()) window.chrome.webview.addEventListener('message', function (ev) {
    var r = ev.data; if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { return; } }
    if (!r || !r.requestId || !_smPending[r.requestId]) return;
    var cb = _smPending[r.requestId]; delete _smPending[r.requestId];
    if (r.action === 'error') cb(r.message || (r.data && r.data.message) || 'Error', null);
    else if (r.action === 'restResponse') { if (r.success === false) cb('HTTP ' + r.statusCode + (r.data ? ': ' + String(r.data).slice(0, 300) : ''), null); else cb(null, r.data); }
    else cb(null, r.data !== undefined ? r.data : r);
});
window.currentInstance = function () { return AG.pod; };
window.appUserName = function () { return appUser() || 'UNKNOWN'; };

/** Raw REST call like the AIDE: GET → executeGet, everything else → executePost with method. */
AG.rest = function (method, url, body) {
    method = String(method || 'GET').toUpperCase();
    return new Promise(function (resolve, reject) {
        var msg = method === 'GET' ? { action: 'executeGet', fullUrl: url } : { action: 'executePost', fullUrl: url, body: body == null ? '{}' : (typeof body === 'string' ? body : JSON.stringify(body)) };
        if (method !== 'GET' && method !== 'POST') msg.method = method;
        sendMessageToCSharp(msg, function (err, data) { if (err) reject(err); else resolve(data); });
    });
};

// ── interactive grid (pick rows → an action) ──
AG.tool('grid', function (inp) {
    return new Promise(function (resolve) {
        AG.pendingCards++;
        var cols = inp.columns || [], rws = (inp.rows || []).slice(0, 500), key = inp.key ? cols.indexOf(inp.key) : 0;
        var acts = (inp.actions && inp.actions.length) ? inp.actions : [{ label: 'Use selected', prompt: 'Continue with the selected rows.' }];
        var fmts = {}; Object.keys(inp.formats || {}).forEach(function (k) { fmts[k.toUpperCase()] = inp.formats[k]; });
        var el = document.createElement('div'); el.className = 'card confirm ask';
        el.innerHTML = '<h4><i class="fa-solid fa-list-check"></i> ' + esc(inp.title || 'Choose rows') + '</h4>' + (inp.markdown ? '<div class="why">' + md(inp.markdown) + '</div>' : '') +
            '<div class="grid-wrap" style="max-height:260px"><table class="t"><thead><tr><th><input type="checkbox" class="all" checked></th>' + cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
            rws.map(function (r, i) {
                var vals = Array.isArray(r) ? r : cols.map(function (c) { return r[c]; }), obj = {}; cols.forEach(function (c, k) { obj[String(c).toUpperCase()] = vals[k]; });
                return '<tr><td><input type="checkbox" class="pick" data-i="' + i + '" checked></td>' + vals.map(function (v, k) { var f = fmts[String(cols[k]).toUpperCase()]; return '<td' + (f && AGF.isNumFormat(f) ? ' class="n"' : '') + '>' + AGF.cell(v, f, { row: obj }) + '</td>'; }).join('') + '</tr>';
            }).join('') +
            '</tbody></table></div><div class="acts">' + acts.map(function (a, i) { return '<button class="btn ' + (i === 0 ? 'primary' : '') + '" data-a="' + i + '">' + esc(a.label) + '</button>'; }).join('') +
            '<button class="btn danger" data-a="-1">None of these</button><span class="muted sm sel"></span></div>';
        var count = function () { el.querySelector('.sel').textContent = el.querySelectorAll('.pick:checked').length + ' selected'; };
        el.querySelector('.all').onchange = function () { var on = this.checked; el.querySelectorAll('.pick').forEach(function (p) { p.checked = on; }); count(); };
        el.querySelectorAll('.pick').forEach(function (p) { p.onchange = count; });
        el.querySelectorAll('[data-a]').forEach(function (b) {
            b.onclick = function () {
                var ai = +b.dataset.a, picked = Array.prototype.map.call(el.querySelectorAll('.pick:checked'), function (p) { return rws[+p.dataset.i]; });
                AG.pendingCards--; el.remove();
                if (ai < 0) { AG.pill('You chose none of the rows'); resolve({ ok: true, content: 'The user chose none of these rows. Ask what they want instead.' }); return; }
                var ids = picked.map(function (r) { return Array.isArray(r) ? r[key < 0 ? 0 : key] : r[inp.key || cols[0]]; });
                AG.pill('You chose "' + acts[ai].label + '" for ' + picked.length + ' row(s)');
                resolve({ ok: true, content: 'The user chose "' + acts[ai].label + '" for ' + picked.length + ' row(s): ' + JSON.stringify(ids).slice(0, 4000) + '\nInstruction: ' + acts[ai].prompt });
            };
        });
        count();
        $('cards').appendChild(el);
    });
});

// ── API form (WMS write APIs, same catalog as the AI Digital Employee) ──
AG.apiForm = function (c, pol) {
    var inp = c.input || {};
    return new Promise(function (resolve) {
        var api = inp.apiId && window.apiCatalogById ? window.apiCatalogById(inp.apiId) : null;
        var raw = !api && inp.request && inp.request.url ? inp.request : null;
        if (!api && !raw) { resolve({ ok: false, content: 'Unknown apiId ' + inp.apiId + ' (and no raw request). Use an id from the WMS API catalog in the knowledge.' }); return; }
        if (raw && !/\/ords\/WKSP_GRAYSAPP\//i.test(raw.url)) { resolve({ ok: false, content: 'Raw requests may only call the app\'s own ORDS (…/ords/WKSP_GRAYSAPP/…).' }); return; }
        AG.pendingCards++;
        var vals = inp.values || {}, el = document.createElement('div'); el.className = 'card confirm';
        var today = new Date().toISOString().slice(0, 10);
        var fieldHtml = api ? (api.fields || []).map(function (f) {
            var v = vals[f.key] !== undefined ? vals[f.key] : f.def === 'today' ? today : f.def != null ? f.def : '';
            var id = 'af_' + f.key;
            if (f.type === 'rows' || f.type === 'json') return '<label class="sm" style="display:block;margin-top:6px"><b>' + esc(f.label || f.key) + (f.required ? ' *' : '') + '</b><textarea id="' + id + '" rows="4" style="width:100%;font-family:var(--mono);font-size:.74rem">' + esc(typeof v === 'string' ? v : JSON.stringify(v || (f.type === 'rows' ? [] : {}), null, 1)) + '</textarea></label>';
            if (f.type === 'textarea') return '<label class="sm" style="display:block;margin-top:6px"><b>' + esc(f.label || f.key) + '</b><textarea id="' + id + '" rows="2" style="width:100%">' + esc(v) + '</textarea></label>';
            return '<label class="sm" style="display:inline-flex;flex-direction:column;margin:6px 8px 0 0"><b>' + esc(f.label || f.key) + (f.required ? ' *' : '') + '</b><input id="' + id + '" type="' + (f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text') + '" value="' + esc(v) + '"></label>';
        }).join('') : '<pre>' + esc(raw.method + ' ' + raw.url + '\n' + JSON.stringify(raw.body || {}, null, 2)) + '</pre>';
        el.innerHTML = '<h4><i class="fa-solid fa-pen-to-square"></i> ' + esc(api ? api.name : (inp.name || 'WMS API call')) + ' <span class="risk act">review &amp; submit</span></h4>' +
            (inp.note ? '<div class="why">' + md(inp.note) + '</div>' : '') + (api && api.desc ? '<div class="muted sm">' + esc(api.desc) + '</div>' : '') + (api && api.note ? '<div class="sm" style="color:#92400e;margin-top:4px">' + esc(api.note) + '</div>' : '') +
            '<div>' + fieldHtml + '</div><div class="facts"><span class="fact' + (AG.pod === 'PROD' ? ' prod' : '') + '">' + AG.pod + '</span><span class="fact">policy wms_api: ' + esc((pol && pol.mode) || 'ASK') + '</span></div>' +
            '<div class="acts"><button class="btn go"><i class="fa-solid fa-paper-plane"></i> Submit</button><button class="btn danger">Cancel</button><span class="err sm msg"></span></div>';
        $('cards').appendChild(el);
        var finish = function (r) { AG.pendingCards--; el.remove(); resolve(r); };
        el.querySelector('.danger').onclick = function () { AG.pill('✖ Cancelled: ' + (api ? api.name : 'API call')); finish({ ok: false, content: 'The user cancelled the form. Nothing was sent.' }); };
        el.querySelector('.go').onclick = function () {
            var req;
            try {
                if (api) {
                    var v = {};
                    (api.fields || []).forEach(function (f) {
                        var x = $('af_' + f.key); if (!x) return;
                        var s = x.value;
                        v[f.key] = (f.type === 'rows' || f.type === 'json') ? (s.trim() ? (f.type === 'rows' ? JSON.parse(s) : s) : (f.type === 'rows' ? [] : '{}')) : s;
                        if (f.required && (s === '' || s == null)) throw (f.label || f.key) + ' is required';
                    });
                    req = window.buildApiRequest(api, v, AG.pod);
                } else req = { method: raw.method || 'POST', url: raw.url, body: JSON.stringify(raw.body || {}) };
            } catch (e) { el.querySelector('.msg').textContent = String(e); return; }
            this.disabled = true;
            var gate = pol && pol.mode === 'AUTO' ? Promise.resolve() : hostOk('agentConfirm', { tool: c.name, input: c.input, pod: c.pod }, 30000);
            gate.then(function () { return AG.rest(req.method, req.url, req.body); }).then(function (res) {
                AG.pill('✔ Sent: ' + (api ? api.name : req.method + ' ' + req.url.split('/ords/')[1]));
                finish({ ok: true, content: 'API_RESULT ' + req.method + ' ' + req.url.split('/ords/')[1] + ': ' + String(typeof res === 'string' ? res : JSON.stringify(res)).slice(0, 6000) });
            }).catch(function (e) { finish({ ok: false, content: 'The API call failed: ' + e }); });
        };
    });
};

// registered so the page reports it as available; runCall sends act calls to AG.apiForm with the policy it got
AG.tool('api_form', function (inp, c) { return AG.apiForm(c, { mode: 'ASK' }); });

// ── Daily Tasks (wms_ai_tasks / wms_ai_task_events, the AI Digital Employee's board) ──
AG.tool('tasks_today', function (inp) {
    var d = /^\d{4}-\d{2}-\d{2}$/.test(inp.date || '') ? inp.date : new Date().toISOString().slice(0, 10), st = AG.words(inp.status)[0];
    var where = inp.task_id ? 't.task_id = ' + (+inp.task_id) : "t.task_date = TO_DATE(" + lit(d) + ", 'YYYY-MM-DD')" + (st ? ' AND t.status = ' + lit(st) : " AND t.status <> 'CANCELLED'");
    return rows("SELECT t.task_id, t.title, TO_CHAR(SUBSTR(t.description, 1, 1500)) AS description, t.category, t.priority, t.status, t.recurrence, t.instance, " +
        "TO_CHAR(SUBSTR(t.result, 1, 800)) AS result, TO_CHAR(SUBSTR(t.issue, 1, 500)) AS issue, " +
        "(SELECT COUNT(*) FROM wms_ai_task_events e WHERE e.task_id = t.task_id) AS events FROM wms_ai_tasks t WHERE " + where + ' ORDER BY t.priority, t.task_id FETCH FIRST 60 ROWS ONLY', 60)
        .then(function (list) {
            if (!list.length) return { ok: true, content: inp.task_id ? 'No task ' + inp.task_id : 'No tasks for ' + d + '.' };
            return { ok: true, content: JSON.stringify(list) };
        }, function (e) { return { ok: false, content: AG.tableMissing(e, 'AI Digital Employee › Daily Tasks') }; });
});
AG.tool('task_log', function (inp) {
    var id = parseInt(inp.task_id, 10), kind = String(inp.kind || 'NOTE').toUpperCase(), st = String(inp.status || '').toUpperCase();
    if (!id || !/^(PROGRESS|ISSUE|RESULT|NOTE)$/.test(kind)) return { ok: false, content: 'task_id and kind (PROGRESS/ISSUE/RESULT/NOTE) are required.' };
    var msg = String(inp.message || '').slice(0, 30000);
    var w = [dbWrite('INSERT INTO wms_ai_task_events (task_id, actor, kind, message) VALUES (' + id + ", 'AI', " + lit(kind) + ', ' + clob(msg) + ')')];
    if (/^(IN_PROGRESS|DONE|BLOCKED)$/.test(st))
        w.push(dbWrite('UPDATE wms_ai_tasks SET status = ' + lit(st) + (st === 'DONE' ? ', result = ' + clob(msg) + ', completed_at = SYSDATE' : st === 'BLOCKED' ? ', issue = ' + clob(msg) : ', started_at = NVL(started_at, SYSDATE)') +
            ', updated_by = ' + vlit(appUser() || 'AI', 120) + ', updated_date = SYSDATE WHERE task_id = ' + id).then(function () {
            return dbWrite('INSERT INTO wms_ai_task_events (task_id, actor, kind, message) VALUES (' + id + ", 'AI', 'STATUS', " + lit(st) + ')');
        }));
    return Promise.all(w).then(function () { AG.loadTasks && AG.loadTasks(); return { ok: true, content: 'Logged ' + kind + (st ? ' and set ' + st : '') + ' on task ' + id + '.' }; },
        function (e) { return { ok: false, content: AG.tableMissing(e, 'AI Digital Employee › Daily Tasks') }; });
});

// ── confirm-card previews of the AI Digital Employee's write actions ──
AG.preview.fusion_call = function (i) {
    return '<div class="why"><b>' + esc(i.method) + '</b> on Oracle Fusion ' + esc(i.instance || AG.pod) + (i.reason ? ' — ' + esc(i.reason) : '') + '</div><pre>' + esc(i.path) + (i.body ? '\n\n' + JSON.stringify(i.body, null, 2) : '') + '</pre>';
};
AG.preview.db_write = function (i) { return '<div class="why">Run on the WMS database' + (i.reason ? ' — ' + esc(i.reason) : '') + ':</div>' + sqlPreview(i.sql); };
AG.preview.wms_job = function (i) { return '<div class="why">Schedule <b>' + esc(i.name || i.jobName || 'job') + '</b> (' + esc(i.lane || 'DB') + ' lane)' + (i.description ? ' — ' + esc(i.description) : '') + '</div><pre>' + esc(JSON.stringify(i, null, 2).slice(0, 4000)) + '</pre>'; };
AG.preview.email = function (i) {
    return '<div class="why">Send an e-mail to <b>' + esc(i.to) + '</b>' + (i.cc ? ' (cc ' + esc(i.cc) + ')' : '') + '</div><div class="fact" style="display:inline-block;margin-bottom:6px">' + esc(i.subject) + '</div>' +
        '<iframe sandbox="" style="width:100%;height:200px;border:1px solid var(--line);border-radius:8px;background:#fff" srcdoc="' + esc(i.bodyHtml || '') + '"></iframe>';
};
AG.preview.device = function (i) {
    if (i.op === 'print_orders') return '<div class="why">Download and print <b>' + (i.orders || []).length + '</b> order PDF(s) on <b>' + esc(i.printer) + '</b> (' + esc(i.instance || AG.pod) + ')</div><div class="facts">' + (i.orders || []).map(function (o) { return '<span class="fact">' + esc(o) + '</span>'; }).join('') + '</div>';
    if (i.op === 'print') { var r = AG.resById(i.result_id); return '<div class="why">Print <b>' + esc(i.title || (r && r.title) || 'the result') + '</b> on <b>' + esc(i.printer) + '</b>' + (r ? ' (' + (r.rows || '?') + ' rows)' : '') + '</div>'; }
    return '<pre>' + esc(JSON.stringify(i, null, 2)) + '</pre>';
};

AG.preview.hardware = function (i) {
    if (i.op === 'set_default_printer') return '<div class="why">Make <b>' + esc(i.printer) + '</b> the default printer of this PC.</div>';
    if (i.op === 'cancel_print_jobs') return '<div class="why">Cancel <b>all queued print jobs</b> on <b>' + esc(i.printer) + '</b> (this PC).</div>' + (i.reason ? '<div class="muted sm">' + esc(i.reason) + '</div>' : '');
    return '<pre>' + esc(JSON.stringify(i, null, 2)) + '</pre>';
};

// ── today's tasks in the sidebar (work one with a click) ──
AG.loadTasks = function () {
    var box = $('tasks'); if (!box) return;
    rows("SELECT task_id, title, status, priority FROM wms_ai_tasks WHERE task_date = TRUNC(SYSDATE) AND status IN ('OPEN','IN_PROGRESS','BLOCKED') ORDER BY priority, task_id FETCH FIRST 20 ROWS ONLY", 20).then(function (list) {
        var col = { OPEN: '#1d4ed8', IN_PROGRESS: '#b45309', BLOCKED: '#b91c1c' };
        box.innerHTML = list.length ? list.map(function (t) {
            return '<div class="th" title="Work this task"><span class="sd" style="background:' + (col[t.STATUS] || '#94a3b8') + '"></span><div class="grow" style="min-width:0"><div class="t">' + esc(t.TITLE) + '</div><div class="m">#' + t.TASK_ID + ' · ' + esc(String(t.STATUS).replace('_', ' ').toLowerCase()) + '</div></div>' +
                '<button class="icon" data-task="' + t.TASK_ID + '" title="Work it"><i class="fa-solid fa-play"></i></button></div>';
        }).join('') : '<div class="muted sm" style="padding:4px 8px">No open tasks today.</div>';
        box.querySelectorAll('[data-task]').forEach(function (b) {
            b.onclick = function () {
                if (AG.busy) return;
                AG.newChat();
                $('input').value = 'Work Daily Task #' + b.dataset.task + ': read it with tasks_today, do it step by step (trained processes first), log PROGRESS / ISSUE / RESULT with task_log and set DONE or BLOCKED at the end.';
                AG.send();
            };
        });
    }).catch(function () { box.innerHTML = '<div class="muted sm" style="padding:4px 8px">Daily Tasks not set up.</div>'; });
};
