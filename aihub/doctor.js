/* AI Hub › Pipeline Doctor (LangGraph): pick a failed pipeline run → the agent triages, diagnoses (through the router),
   asks this page to TEST its fix on the task's source (read-only), waits for a person's approval, then asks this page to
   APPLY the patch to WMS_PIPE_TASKS (and queue a re-run). Each pause is a LangGraph interrupt; the hub keeps the thread
   in a SQLite checkpoint, so it can wait for days and survive a restart. */
var DC = { runs: [], threads: [], tid: null, snap: null, busy: false, err: null };
var DC_NODES = [['triage', 'Triage'], ['diagnose', 'Diagnose'], ['verify', 'Test fix'], ['propose', 'Propose'], ['approval', 'Approval'], ['apply', 'Apply'], ['report', 'Report']];
var DC_PATCH_COLS = { source_sql: 'clob', column_map_json: 4000, key_columns: 1000, watermark_column: 128, target_object: 400, load_mode: 'mode', batch_size: 'int', timeout_seconds: 'int' };

function dcRender() {
    var el = $('page-doctor');
    if (AH.need(el)) return;
    if (!DC.runs.length && !DC.threads.length) el.innerHTML = '<div class="empty"><i class="fa-solid fa-spinner fa-spin"></i> Loading failed runs…</div>';
    Promise.all([dcLoadRuns(), dcLoadThreads()]).then(function () {
        if (!DC.tid && DC.threads[0]) DC.tid = DC.threads[0].thread_id;
        return DC.tid ? dcOpen(DC.tid, true) : null;
    }).then(dcDraw).catch(function (e) { el.innerHTML = '<div class="card err">' + esc(e) + '</div>'; });
}
function dcLoadRuns() {
    return rows("SELECT r.run_id, r.pipeline_id, p.pipeline_name, TO_CHAR(r.requested_date, 'YYYY-MM-DD HH24:MI') AS at, r.error_text, r.requested_by FROM wms_pipe_runs r " +
        "JOIN wms_pipelines p ON p.pipeline_id = r.pipeline_id WHERE r.status = 'FAILED' ORDER BY r.run_id DESC", 40).then(function (r) { DC.runs = r; }).catch(function () { DC.runs = []; });
}
function dcLoadThreads() { return hub('GET', '/agents/doctor/threads?limit=40').then(function (r) { DC.threads = r; }); }
function dcOpen(tid, quiet) {
    DC.tid = tid;
    return hub('GET', '/agents/doctor/' + encodeURIComponent(tid)).then(function (s) { DC.snap = s; if (!quiet) dcDraw(); dcAuto(); })
        .catch(function (e) { DC.snap = null; if (!quiet) toast(String(e), 'err'); });
}

/** Everything the agent needs about a failed run, read from the pipeline tables. */
function dcContext(run) {
    var ctx = { pipeline: run.PIPELINE_NAME, pipeline_id: run.PIPELINE_ID, run_id: run.RUN_ID, run_status: 'FAILED', pod: ls('pod', 'PROD'), error: run.ERROR_TEXT };
    return rows('SELECT task_id, error_text, watermark_from FROM wms_pipe_task_runs WHERE run_id = ' + parseInt(run.RUN_ID, 10) + " AND status = 'FAILED' ORDER BY task_run_id DESC", 5).then(function (tr) {
        var tid = tr[0] && tr[0].TASK_ID;
        if (tr[0] && tr[0].ERROR_TEXT) ctx.error = tr[0].ERROR_TEXT;
        var pieces = [0, 1, 2, 3, 4].map(function (i) { return 'TO_CHAR(SUBSTR(t.source_sql, ' + (i * 3000 + 1) + ', 3000)) AS p' + i; }).join(', ');
        return Promise.all([
            rows('SELECT t.task_id, t.task_name, t.source_type, t.target_object, t.load_mode, t.key_columns, t.column_map_json, t.watermark_column, t.last_watermark, t.batch_size, t.timeout_seconds, ' +
                'c.conn_type AS target_type, s.conn_name AS source_label, ' + pieces + ' FROM wms_pipe_tasks t LEFT JOIN wms_pipe_connections c ON c.conn_id = t.target_conn_id ' +
                'LEFT JOIN wms_pipe_connections s ON s.conn_id = t.source_conn_id WHERE ' + (tid ? 't.task_id = ' + parseInt(tid, 10) : 't.pipeline_id = ' + parseInt(run.PIPELINE_ID, 10) + ' ORDER BY t.seq'), 1),
            rows("SELECT TO_CHAR(log_time, 'HH24:MI:SS') AS t, log_level, message FROM wms_pipe_log WHERE run_id = " + parseInt(run.RUN_ID, 10) + ' ORDER BY log_id DESC', 60)
        ]);
    }).then(function (r) {
        var t = r[0][0] || {};
        ctx.task = { id: t.TASK_ID, name: t.TASK_NAME, source_type: t.SOURCE_TYPE, source_label: t.SOURCE_LABEL, target_type: t.TARGET_TYPE, target_object: t.TARGET_OBJECT, load_mode: t.LOAD_MODE,
            key_columns: t.KEY_COLUMNS, column_map_json: t.COLUMN_MAP_JSON, watermark_column: t.WATERMARK_COLUMN, watermark_value: t.LAST_WATERMARK, batch_size: t.BATCH_SIZE, timeout_seconds: t.TIMEOUT_SECONDS,
            source_sql: [t.P0, t.P1, t.P2, t.P3, t.P4].filter(Boolean).join('') };
        ctx.log = r[1].reverse().map(function (l) { return l.T + ' ' + l.LOG_LEVEL + ' ' + l.MESSAGE; });
        return ctx;
    });
}
function dcSampleContext() {
    return { sample: true, pipeline: 'Sample: AP invoices to DuckDB', pipeline_id: 0, run_id: 'sample', run_status: 'FAILED', pod: ls('pod', 'PROD'),
        error: 'ORA-00904: "INVOICE_AMT": invalid identifier',
        log: ['10:02:01 INFO Run started (MANUAL by ' + appUser() + ')', '10:02:01 INFO Task "Open AP invoices" started — INCREMENTAL on LAST_UPDATE_DATE', '10:02:04 ERROR Fusion runner: ORA-00904: "INVOICE_AMT": invalid identifier', '10:02:04 ERROR Task "Open AP invoices" failed — run stopped (on_error = STOP)'],
        task: { id: 0, name: 'Open AP invoices', source_type: 'FUSION', target_type: 'DUCKDB', target_object: 'AP_INVOICES', load_mode: 'INCREMENTAL', key_columns: 'INVOICE_ID', watermark_column: 'LAST_UPDATE_DATE', batch_size: 5000,
            source_sql: 'SELECT invoice_id, invoice_num, vendor_id, invoice_amt, invoice_currency_code, last_update_date FROM ap_invoices_all WHERE cancelled_date IS NULL' } };
}
function dcStart(run) {
    if (DC.busy) return;
    DC.busy = true; DC.err = null; dcDraw();
    (run ? dcContext(run) : Promise.resolve(dcSampleContext())).then(function (ctx) {
        return hub('POST', '/agents/doctor/start', { context: ctx });
    }).then(function (s) { DC.snap = s; DC.tid = s.thread_id; return dcLoadThreads(); })
        .catch(function (e) { DC.err = String(e); toast(DC.err, 'err'); })
        .then(function () { DC.busy = false; dcDraw(); dcAuto(); });
}
function dcResume(value) {
    if (DC.busy || !DC.tid) return Promise.resolve();
    DC.busy = true; dcDraw();
    return hub('POST', '/agents/doctor/' + encodeURIComponent(DC.tid) + '/resume', { value: value }).then(function (s) { DC.snap = s; return dcLoadThreads(); })
        .catch(function (e) { toast(String(e), 'err'); })
        .then(function () { DC.busy = false; dcDraw(); dcAuto(); });
}
/** The page does what the graph asks: run the test (if auto) and apply an approved patch. */
function dcAuto() {
    var w = DC.snap && DC.snap.waiting; if (!w || DC.busy) return;
    if (w.kind === 'apply') dcApply(w);
    else if (w.kind === 'verify' && ls('doc.autotest', true)) dcVerify();
}
function dcVerify() {
    var w = DC.snap.waiting, t0 = Date.now(), st = String(w.source_type || '').toUpperCase();
    DC.busy = true; dcDraw();
    var run = st === 'APEX' ? rows(w.sql, 50).then(function (r) { return { rows: r.length }; }) : fusion(w.sql, 50, w.pod || ls('pod', 'PROD')).then(function (r) { return { rows: r.rows.length, columns: (r.columns || []).map(function (c) { return c.name || c; }) }; });
    run.then(function (r) { return Object.assign({ ok: true, ms: Date.now() - t0 }, r); }, function (e) { return { ok: false, error: String(e), ms: Date.now() - t0 }; })
        .then(function (res) { DC.busy = false; return dcResume(res); });
}
function dcApply(w) {
    var ctx = DC.snap.state.context || {};
    DC.busy = true; dcDraw();
    if (ctx.sample) { DC.busy = false; dcResume({ ok: true, sample: true, note: 'sample — nothing written' }); return; }
    var sets = [];
    Object.keys(w.patch || {}).forEach(function (k) {
        var kind = DC_PATCH_COLS[k], v = w.patch[k]; if (!kind) return;
        if (kind === 'clob') sets.push(k + ' = ' + clob(v));
        else if (kind === 'int') { var n = parseInt(v, 10); if (n > 0) sets.push(k + ' = ' + n); }
        else if (kind === 'mode') { if (/^(APPEND|TRUNCATE_INSERT|MERGE|INCREMENTAL)$/.test(v)) sets.push(k + ' = ' + lit(v)); }
        else sets.push(k + ' = ' + vlit(v, kind));
    });
    if (!sets.length) { DC.busy = false; dcResume({ ok: false, error: 'Nothing in the patch can be written.' }); return; }
    dbWrite('UPDATE wms_pipe_tasks SET ' + sets.join(', ') + ', updated_by = ' + vlit(appUser() || 'AI_HUB', 120) + ', updated_date = SYSDATE WHERE task_id = ' + parseInt(w.task_id, 10))
        .then(function () {
            if (!w.rerun) return null;
            return dbWrite("INSERT INTO wms_pipe_runs (pipeline_id, trigger_type, requested_by, status) VALUES (" + parseInt(w.pipeline_id, 10) + ", 'MANUAL', " + vlit(appUser() || 'AI_HUB', 120) + ", 'QUEUED')")
                .then(function () { return rows('SELECT MAX(run_id) AS id FROM wms_pipe_runs WHERE pipeline_id = ' + parseInt(w.pipeline_id, 10) + " AND status = 'QUEUED'", 1); })
                .then(function (r) { return r[0] && r[0].ID; });
        })
        .then(function (rid) { DC.busy = false; return dcResume({ ok: true, rerun_run_id: rid || null }); }, function (e) { DC.busy = false; return dcResume({ ok: false, error: String(e) }); });
}

// ── drawing ────────────────────────────────────────────────────
function dcGraph(s) {
    var tl = ((s && s.state && s.state.timeline) || []).map(function (x) { return x.node; }).filter(function (n) { return n !== 'start'; });
    var visited = {}; tl.forEach(function (n) { visited[n] = 1; });
    var cur = s && s.waiting ? s.waiting.kind : null, walked = {};
    for (var i = 1; i < tl.length; i++) walked[tl[i - 1] + '>' + tl[i]] = 1;
    var X = function (i) { return 14 + i * 122; }, W = 104, H = 36, Y = 58;
    var idx = {}; DC_NODES.forEach(function (n, i) { idx[n[0]] = i; });
    var edge = function (a, b, curve) {
        var x1 = X(idx[a]) + (curve ? W / 2 : W), x2 = X(idx[b]) + (curve ? W / 2 : 0), d;
        if (!curve) d = 'M' + x1 + ',' + (Y + H / 2) + ' L' + (x2 - 2) + ',' + (Y + H / 2);
        else { var yy = curve < 0 ? Y : Y + H, c = curve < 0 ? Y - 40 : Y + H + 40; d = 'M' + x1 + ',' + yy + ' C' + x1 + ',' + c + ' ' + x2 + ',' + c + ' ' + x2 + ',' + (yy + (curve < 0 ? -2 : 2)); }
        return '<path class="edge' + (walked[a + '>' + b] ? ' walked' : '') + '" d="' + d + '" marker-end="url(#dc-ar)"/>';
    };
    var svg = '<svg class="graph" viewBox="0 0 870 150" role="img" aria-label="Pipeline Doctor graph"><defs><marker id="dc-ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0L10,5L0,10z" fill="#94a3b8"/></marker></defs>' +
        edge('triage', 'diagnose') + edge('diagnose', 'verify') + edge('diagnose', 'propose', 1) + edge('verify', 'diagnose', -1) + edge('verify', 'propose') + edge('propose', 'approval') + edge('approval', 'apply') + edge('approval', 'report', 1) + edge('apply', 'report');
    DC_NODES.forEach(function (n, i) {
        var c = cur === n[0] ? 'cur' : visited[n[0]] ? 'done' : '';
        svg += '<g class="node ' + c + '"><rect x="' + X(i) + '" y="' + Y + '" width="' + W + '" height="' + H + '" rx="9"/><text x="' + (X(i) + W / 2) + '" y="' + (Y + 22) + '" text-anchor="middle">' + n[1] + '</text>' +
            (/verify|approval|apply/.test(n[0]) ? '<text class="pause" x="' + (X(i) + W - 8) + '" y="' + (Y - 4) + '" text-anchor="end">⏸ waits for ' + (n[0] === 'approval' ? 'you' : 'the app') + '</text>' : '') + '</g>';
    });
    return svg + '</svg>';
}
function dcDraw() {
    var el = $('page-doctor'), s = DC.snap, st = s && s.state || {}, d = st.diagnosis, w = s && s.waiting, ctx = st.context || {};
    var left = '<div class="card stack"><div class="row"><h3 style="margin:0"><i class="fa-solid fa-triangle-exclamation"></i> Failed runs</h3><span class="grow"></span><button class="icon" title="Reload" onclick="dcRender()"><i class="fa-solid fa-rotate"></i></button></div>' +
        '<div class="list">' + (DC.runs.length ? DC.runs.map(function (r, i) { return '<div class="li"><b>' + esc(r.PIPELINE_NAME) + '</b><span class="muted">run #' + r.RUN_ID + ' · ' + esc(r.AT) + '</span><div class="sm err" style="margin:3px 0">' + esc(String(r.ERROR_TEXT || '').slice(0, 140)) + '</div><button class="btn sm primary" onclick="dcStart(DC.runs[' + i + '])"' + (DC.busy ? ' disabled' : '') + '><i class="fa-solid fa-user-doctor"></i> Diagnose</button></div>'; }).join('')
            : '<div class="muted sm">No failed pipeline runs.</div>') + '</div>' +
        '<button class="btn" onclick="dcStart(null)"' + (DC.busy ? ' disabled' : '') + '><i class="fa-solid fa-flask"></i> Try a sample failure</button>' +
        '<h3 style="margin:8px 0 0"><i class="fa-solid fa-diagram-project"></i> Doctor threads</h3><div class="list">' + (DC.threads.length ? DC.threads.map(function (t) {
            return '<div class="li' + (t.thread_id === DC.tid ? ' sel' : '') + '" onclick="dcOpen(\'' + esc(t.thread_id) + '\')"><div class="row"><b class="grow">' + esc(t.pipeline || '') + '</b><span class="st ' + esc(t.status) + '">' + esc(String(t.status).replace('waiting_', 'waits: ')) + '</span></div>' +
                '<span class="muted">' + esc(t.task || '') + ' · ' + new Date(t.created * 1000).toLocaleString() + (t.category ? ' · ' + esc(t.category) : '') + '</span></div>';
        }).join('') : '<div class="muted sm">None yet.</div>') + '</div></div>';
    var main;
    if (!s) main = '<div class="card empty">' + (DC.busy ? '<i class="fa-solid fa-spinner fa-spin"></i> The doctor is reading the run…' : 'Pick a failed run and press <b>Diagnose</b> — or try the sample.') + '</div>';
    else {
        var head = '<div class="card"><div class="row"><h3 style="margin:0"><i class="fa-solid fa-user-doctor"></i> ' + esc(ctx.pipeline) + ' <span class="muted sm">run #' + esc(ctx.run_id) + ' · ' + esc((ctx.task || {}).name || '') + '</span></h3><span class="grow"></span>' +
            '<span class="st ' + esc(s.status) + '">' + esc(String(s.status).replace('waiting_', 'waits: ')) + '</span>' + (st.model && st.model.provider ? '<span class="b">' + esc(st.model.provider + ' / ' + st.model.model) + ' · ' + money(st.model.cost) + '</span>' : '') + '</div>' + dcGraph(s) + '</div>';
        var act = '';
        if (DC.busy) act = '<div class="action"><i class="fa-solid fa-spinner fa-spin"></i> Working…</div>';
        else if (w && w.kind === 'verify') act = '<div class="action stack"><b><i class="fa-solid fa-vial"></i> The doctor wants to test its fix on ' + esc(w.source_type) + (w.pod ? ' (' + esc(w.pod) + ')' : '') + ' — read-only, 50 rows</b><pre class="out">' + esc(w.sql) + '</pre>' +
            '<div class="row"><button class="btn primary" onclick="dcVerify()"><i class="fa-solid fa-play"></i> Run the test</button><button class="btn" onclick="dcResume({ok:false,error:\'skipped by \' + appUser()})">Skip the test</button>' +
            '<label class="row sm"><input type="checkbox" ' + (ls('doc.autotest', true) ? 'checked' : '') + ' onchange="lsSet(\'doc.autotest\', this.checked)"> run tests automatically</label></div></div>';
        else if (w && w.kind === 'approval') {
            var patch = w.patch || {}, keys = Object.keys(patch), task = ctx.task || {};
            act = '<div class="action stack"><b><i class="fa-solid fa-hand"></i> Your decision — nothing is changed until you approve</b>' +
                (keys.length ? keys.map(function (k) {
                    return k === 'source_sql' ? '<div><b class="sm">source_sql</b><div class="diff"><div><span class="sm muted">now</span><pre class="out old">' + esc(task.source_sql) + '</pre></div><div><span class="sm muted">proposed (you can edit)</span><textarea class="code" id="dc-p-source_sql" rows="8" style="width:100%">' + esc(patch[k]) + '</textarea></div></div></div>'
                        : '<label class="f">' + esc(k) + ' <span class="muted">(now: ' + esc(task[k] == null ? '—' : task[k]) + ')</span><input type="text" id="dc-p-' + k + '" value="' + esc(patch[k]) + '"></label>';
                }).join('') : '<p class="sm">No change to the task is proposed — this is advice (' + esc((d || {}).fix_kind) + ').</p>') +
                (w.verify && w.verify.sql ? '<p class="sm ' + (w.verify.ok ? 'ok' : 'err') + '">' + (w.verify.ok ? '✓ The fix ran on the source: ' + w.verify.rows + ' rows' : '✗ The test failed: ' + esc(w.verify.error)) + '</p>' : '') +
                '<label class="f">Note<input type="text" id="dc-note" placeholder="optional"></label><div class="row">' +
                (keys.length && !ctx.sample ? '<label class="row sm"><input type="checkbox" id="dc-rerun" checked> re-run the pipeline after applying</label>' : '') +
                '<button class="btn primary" onclick="dcDecide(true)"><i class="fa-solid fa-check"></i> ' + (keys.length ? 'Approve and apply' : 'Acknowledge') + '</button><button class="btn danger" onclick="dcDecide(false)"><i class="fa-solid fa-xmark"></i> Reject</button></div></div>';
        } else if (st.summary) act = '<div class="card" style="border-color:#5eead4"><div class="sm">' + esc(st.summary).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>') + '</div>' +
            (st.applied && st.applied.rerun_run_id ? '<p class="sm ok" style="margin-top:6px"><i class="fa-solid fa-rotate"></i> Re-run #' + st.applied.rerun_run_id + ' queued — the pipeline server picks it up on its next poll.</p>' : '') +
            (st.applied && st.applied.sample ? '<p class="sm muted" style="margin-top:6px">Sample: nothing was written.</p>' : '') + '</div>';
        var diag = d ? '<div class="card stack"><h3 style="margin:0"><i class="fa-solid fa-stethoscope"></i> Diagnosis <span class="st advice">' + esc(d.category) + '</span></h3>' +
            '<div><span class="sm muted">confidence ' + Math.round((+d.confidence || 0) * 100) + ' %</span><div class="conf"><i style="width:' + Math.round((+d.confidence || 0) * 100) + '%"></i></div></div>' +
            '<p class="sm"><b>Cause.</b> ' + esc(d.cause) + '</p>' + (d.evidence ? '<pre class="out" style="max-height:120px">' + esc(d.evidence) + '</pre>' : '') +
            '<p class="sm"><b>Fix (' + esc(d.fix_kind) + ').</b> ' + esc(d.fix_summary) + '</p></div>' : '';
        var tl = '<div class="card"><h3><i class="fa-solid fa-timeline"></i> Timeline</h3><div class="tl">' + (st.timeline || []).map(function (x) {
            return '<div><b>' + esc(x.node) + '</b> <span class="when">' + esc(x.at) + (x.model ? ' · ' + esc(x.model) : '') + (x.cost ? ' · ' + money(x.cost) : '') + (x.ms ? ' · ' + x.ms + ' ms' : '') + '</span><div>' + esc(x.text) + '</div></div>';
        }).join('') + '</div></div>';
        main = head + '<div style="margin-top:12px">' + act + '</div><div class="diag" style="margin-top:12px">' + (diag || '<div></div>') + tl + '</div>';
    }
    el.innerHTML = '<h2><i class="fa-solid fa-user-doctor"></i> Pipeline Doctor <span class="b">LangGraph</span></h2><p class="lead">An agent with a human in the loop: it reads a failed run, tests its own fix on the source, and changes nothing until you approve. Threads are checkpointed — they wait for you as long as needed.</p>' +
        (DC.err ? '<div class="card err" style="margin-bottom:10px">' + esc(DC.err) + '</div>' : '') + '<div class="doc">' + left + '<div>' + main + '</div></div>';
}
function dcDecide(approved) {
    var w = DC.snap.waiting, patch = {};
    Object.keys(w.patch || {}).forEach(function (k) { var i = $('dc-p-' + k); patch[k] = i ? i.value : w.patch[k]; });
    dcResume({ approved: approved, by: appUser() || 'someone', note: ($('dc-note') || {}).value || '', rerun: !!($('dc-rerun') && $('dc-rerun').checked), patch: approved ? patch : null });
}
