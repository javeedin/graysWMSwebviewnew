/* ═══════════════════════════════════════════════════════════════
   Fusion SQL — Pipelines tab
   A pipeline = one or more TASKS (source SQL → target connection /
   table, load mode) + a SCHEDULE (manual, every n minutes, cron,
   or continuous until cancelled). The Python FastAPI pipeline
   server (Setups › Data pipeline setups) runs them; this page edits
   the definitions, starts / cancels runs and shows live progress
   from WMS_PIPE_RUNS / WMS_PIPE_TASK_RUNS / WMS_PIPE_LOG.
   Run now  → POST /pipelines/{id}/run on the server; when the server
              cannot be reached the run is queued in WMS_PIPE_RUNS and
              the server starts it on its next poll.
   Cancel   → POST /runs/{id}/cancel + cancel_requested = 'Y'.
   Tables: apex_sql/69_fusion_pipelines.sql (auto-created here).
   ═══════════════════════════════════════════════════════════════ */

var PL = { state: 'idle', error: null, list: [], selId: null, pipe: null, tasks: [], runs: [], runSel: null, runDetail: null, poll: null };
var PL_DDL = {
    WMS_PIPELINES: [
        'CREATE TABLE wms_pipelines (pipeline_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, pipeline_name VARCHAR2(200) NOT NULL, description VARCHAR2(2000), ' +
        "server_id NUMBER, schedule_type VARCHAR2(20) DEFAULT 'MANUAL' NOT NULL, interval_seconds NUMBER, cron_expr VARCHAR2(100), timezone VARCHAR2(60), start_date DATE, end_date DATE, " +
        "enabled VARCHAR2(1) DEFAULT 'N' CHECK (enabled IN ('Y','N')), params_json VARCHAR2(4000), on_error VARCHAR2(10) DEFAULT 'STOP', notify_email VARCHAR2(400), " +
        "state VARCHAR2(20) DEFAULT 'IDLE', next_run_date TIMESTAMP, last_run_id NUMBER, last_run_status VARCHAR2(20), last_run_date TIMESTAMP, created_by VARCHAR2(120), " +
        'created_date DATE DEFAULT SYSDATE, updated_by VARCHAR2(120), updated_date DATE, ' +
        "CONSTRAINT wms_pipelines_sched_ck CHECK (schedule_type IN ('MANUAL','INTERVAL','CRON','CONTINUOUS')))",
        'CREATE UNIQUE INDEX wms_pipelines_name_ux ON wms_pipelines (UPPER(pipeline_name))'
    ],
    WMS_PIPE_TASKS: [
        'CREATE TABLE wms_pipe_tasks (task_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, pipeline_id NUMBER NOT NULL, seq NUMBER NOT NULL, task_name VARCHAR2(200) NOT NULL, ' +
        "source_type VARCHAR2(20) DEFAULT 'FUSION' NOT NULL, source_conn_id NUMBER, source_sql CLOB NOT NULL, target_conn_id NUMBER NOT NULL, target_object VARCHAR2(400) NOT NULL, " +
        "load_mode VARCHAR2(20) DEFAULT 'APPEND' NOT NULL, key_columns VARCHAR2(1000), column_map_json VARCHAR2(4000), create_target VARCHAR2(1) DEFAULT 'Y' CHECK (create_target IN ('Y','N')), " +
        'watermark_column VARCHAR2(128), last_watermark VARCHAR2(100), batch_size NUMBER DEFAULT 5000, row_limit NUMBER, timeout_seconds NUMBER DEFAULT 900, depends_on VARCHAR2(400), ' +
        "active VARCHAR2(1) DEFAULT 'Y' CHECK (active IN ('Y','N')), created_by VARCHAR2(120), created_date DATE DEFAULT SYSDATE, updated_by VARCHAR2(120), updated_date DATE, " +
        "CONSTRAINT wms_pipe_tasks_src_ck CHECK (source_type IN ('FUSION','APEX','CONNECTION')), CONSTRAINT wms_pipe_tasks_mode_ck CHECK (load_mode IN ('APPEND','TRUNCATE_INSERT','MERGE','INCREMENTAL')))",
        'CREATE INDEX wms_pipe_tasks_px ON wms_pipe_tasks (pipeline_id, seq)'
    ],
    WMS_PIPE_RUNS: [
        'CREATE TABLE wms_pipe_runs (run_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, pipeline_id NUMBER NOT NULL, server_id NUMBER, trigger_type VARCHAR2(20), ' +
        "requested_by VARCHAR2(120), requested_date TIMESTAMP DEFAULT SYSTIMESTAMP, status VARCHAR2(20) DEFAULT 'QUEUED', cancel_requested VARCHAR2(1) DEFAULT 'N' CHECK (cancel_requested IN ('Y','N')), " +
        'cycle_no NUMBER DEFAULT 1, params_json VARCHAR2(4000), started_date TIMESTAMP, ended_date TIMESTAMP, rows_read NUMBER DEFAULT 0, rows_written NUMBER DEFAULT 0, error_text VARCHAR2(4000))',
        'CREATE INDEX wms_pipe_runs_px ON wms_pipe_runs (pipeline_id, requested_date)'
    ],
    WMS_PIPE_TASK_RUNS: [
        'CREATE TABLE wms_pipe_task_runs (task_run_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, run_id NUMBER NOT NULL, task_id NUMBER NOT NULL, cycle_no NUMBER DEFAULT 1, ' +
        'status VARCHAR2(20), started_date TIMESTAMP, ended_date TIMESTAMP, rows_read NUMBER, rows_written NUMBER, watermark_from VARCHAR2(100), watermark_to VARCHAR2(100), error_text VARCHAR2(4000))',
        'CREATE INDEX wms_pipe_task_runs_rx ON wms_pipe_task_runs (run_id)'
    ],
    WMS_PIPE_LOG: [
        'CREATE TABLE wms_pipe_log (log_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, run_id NUMBER, task_run_id NUMBER, log_time TIMESTAMP DEFAULT SYSTIMESTAMP, log_level VARCHAR2(10), message VARCHAR2(4000))',
        'CREATE INDEX wms_pipe_log_rx ON wms_pipe_log (run_id, log_id)'
    ]
};
var PL_MODES = {
    APPEND: ['Append', 'Insert the rows every run'],
    TRUNCATE_INSERT: ['Replace', 'Empty the target, then insert'],
    MERGE: ['Merge / upsert', 'Update rows with the same key, insert new ones'],
    INCREMENTAL: ['Incremental', 'Only rows changed since the last run (watermark column)']
};
var PL_SOURCES = { FUSION: ['Fusion (BI Publisher runner)', 'fa-cloud'], APEX: ['APEX database', 'fa-database'], CONNECTION: ['Another connection', 'fa-plug'] };
var PL_ACTIVE = /^(QUEUED|RUNNING|CANCEL_REQUESTED)$/;

// ── tables & loading ───────────────────────────────────────────
function plEnsureTables() {
    return dbRead("SELECT table_name FROM user_tables WHERE table_name IN ('WMS_PIPELINES','WMS_PIPE_TASKS','WMS_PIPE_RUNS','WMS_PIPE_TASK_RUNS','WMS_PIPE_LOG')", 10).then(function (r) {
        var have = {}; r.forEach(function (x) { have[x.TABLE_NAME] = 1; });
        var todo = [];
        Object.keys(PL_DDL).forEach(function (t) { if (!have[t]) todo = todo.concat(PL_DDL[t]); });
        if (todo.length) toast('Creating the pipeline tables in the APEX database…', 'warn');
        return todo.reduce(function (p, ddl) { return p.then(function () { return dbWrite(ddl); }); }, Promise.resolve());
    });
}
function plLoadList() {
    PL.state = PL.state === 'ready' ? 'ready' : 'loading'; plRenderList();
    var setup = PS.state === 'ready' ? Promise.resolve() : psLoad().catch(function () { });
    return setup.then(plEnsureTables).then(function () {
        return dbRead('SELECT p.pipeline_id, p.pipeline_name, p.description, p.schedule_type, p.interval_seconds, p.cron_expr, p.enabled, p.state, ' +
            "TO_CHAR(p.next_run_date, 'YYYY-MM-DD HH24:MI') AS next_run, " +
            '(SELECT COUNT(*) FROM wms_pipe_tasks t WHERE t.pipeline_id = p.pipeline_id) AS task_count, ' +
            '(SELECT r.status FROM wms_pipe_runs r WHERE r.run_id = (SELECT MAX(x.run_id) FROM wms_pipe_runs x WHERE x.pipeline_id = p.pipeline_id)) AS last_status, ' +
            "(SELECT TO_CHAR(MAX(x.requested_date), 'YYYY-MM-DD HH24:MI') FROM wms_pipe_runs x WHERE x.pipeline_id = p.pipeline_id) AS last_run " +
            'FROM wms_pipelines p ORDER BY UPPER(p.pipeline_name)', 500);
    }).then(function (rows) {
        PL.state = 'ready'; PL.error = null;
        PL.list = rows.map(function (r) {
            return { id: r.PIPELINE_ID, name: r.PIPELINE_NAME, description: r.DESCRIPTION || '', schedule: r.SCHEDULE_TYPE, interval: r.INTERVAL_SECONDS, cron: r.CRON_EXPR,
                enabled: r.ENABLED === 'Y', state: r.STATE, nextRun: r.NEXT_RUN, tasks: +r.TASK_COUNT || 0, lastStatus: r.LAST_STATUS, lastRun: r.LAST_RUN };
        });
        var b = $('fs-pl-count'); if (b) { b.textContent = PL.list.length; b.classList.toggle('muted', !PL.list.length); }
        if (PL.selId && !PL.list.some(function (p) { return String(p.id) === String(PL.selId); })) PL.selId = null;
        if (PL.selId === null && PL.list.length && !PL.creating) return plSelect(PL.list[0].id);
        plRenderList(); plRenderMain();
    }).catch(function (e) { PL.state = 'offline'; PL.error = String(e); plRenderList(); plRenderMain(); });
}
function plSelect(id) {
    PL.selId = id; PL.creating = false; PL.runSel = null; PL.runDetail = null;
    plRenderList();
    $('pl-main').innerHTML = '<div class="fs-muted" style="padding:30px;"><span class="fs-spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:middle;"></span> Loading pipeline…</div>';
    return plLoadPipe(id).then(function () { plRenderMain(); plAutoPoll(); });
}
function plLoadPipe(id) {
    var pid = parseInt(id, 10), pieces = [];
    for (var i = 0; i < SQL_PIECES; i++) pieces.push('TO_CHAR(SUBSTR(source_sql, ' + (i * SQL_PIECE + 1) + ', ' + SQL_PIECE + ')) AS p' + i);
    return Promise.all([
        dbRead('SELECT pipeline_id, pipeline_name, description, server_id, schedule_type, interval_seconds, cron_expr, timezone, ' +
            "TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date, TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date, enabled, params_json, on_error, notify_email, state, " +
            "TO_CHAR(next_run_date, 'YYYY-MM-DD HH24:MI:SS') AS next_run, created_by, TO_CHAR(created_date, 'YYYY-MM-DD HH24:MI') AS created, updated_by, " +
            "TO_CHAR(updated_date, 'YYYY-MM-DD HH24:MI') AS updated FROM wms_pipelines WHERE pipeline_id = " + pid, 1),
        dbRead('SELECT task_id, seq, task_name, source_type, source_conn_id, target_conn_id, target_object, load_mode, key_columns, column_map_json, create_target, ' +
            'watermark_column, last_watermark, batch_size, row_limit, timeout_seconds, active, ' + pieces.join(', ') + ' FROM wms_pipe_tasks WHERE pipeline_id = ' + pid + ' ORDER BY seq, task_id', 200),
        plReadRuns(pid)
    ]).then(function (res) {
        var h = res[0][0]; if (!h) throw 'Pipeline not found';
        var params = {}; try { params = h.PARAMS_JSON ? JSON.parse(h.PARAMS_JSON) : {}; } catch (e) { }
        PL.pipe = { id: h.PIPELINE_ID, name: h.PIPELINE_NAME, description: h.DESCRIPTION || '', serverId: h.SERVER_ID, schedule: h.SCHEDULE_TYPE || 'MANUAL', interval: h.INTERVAL_SECONDS,
            cron: h.CRON_EXPR || '', timezone: h.TIMEZONE || '', startDate: h.START_DATE || '', endDate: h.END_DATE || '', enabled: h.ENABLED === 'Y', params: params,
            onError: h.ON_ERROR || 'STOP', notify: h.NOTIFY_EMAIL || '', state: h.STATE, nextRun: h.NEXT_RUN, createdBy: h.CREATED_BY, created: h.CREATED, updatedBy: h.UPDATED_BY, updated: h.UPDATED };
        PL.tasks = res[1].map(function (r) {
            var sql = ''; for (var i = 0; i < SQL_PIECES; i++) sql += r['P' + i] || '';
            return { id: r.TASK_ID, seq: +r.SEQ, name: r.TASK_NAME, sourceType: r.SOURCE_TYPE || 'FUSION', sourceConnId: r.SOURCE_CONN_ID, sql: sql, targetConnId: r.TARGET_CONN_ID,
                target: r.TARGET_OBJECT, mode: r.LOAD_MODE || 'APPEND', keys: r.KEY_COLUMNS || '', createTarget: r.CREATE_TARGET !== 'N', watermarkCol: r.WATERMARK_COLUMN || '',
                watermark: r.LAST_WATERMARK || '', batch: r.BATCH_SIZE || 5000, rowLimit: r.ROW_LIMIT, timeout: r.TIMEOUT_SECONDS || 900, active: r.ACTIVE !== 'N' };
        });
        PL.runs = res[2];
    });
}
function plReadRuns(pid) {
    return dbRead('SELECT run_id, trigger_type, requested_by, status, cancel_requested, cycle_no, rows_read, rows_written, error_text, ' +
        "TO_CHAR(requested_date, 'YYYY-MM-DD HH24:MI:SS') AS requested, TO_CHAR(started_date, 'YYYY-MM-DD HH24:MI:SS') AS started, TO_CHAR(ended_date, 'YYYY-MM-DD HH24:MI:SS') AS ended, " +
        "ROUND((CAST(NVL(ended_date, SYSTIMESTAMP) AS DATE) - CAST(NVL(started_date, requested_date) AS DATE)) * 86400) AS secs " +
        'FROM wms_pipe_runs WHERE pipeline_id = ' + parseInt(pid, 10) + ' ORDER BY run_id DESC', 15).then(function (rows) {
            return rows.map(function (r) {
                return { id: r.RUN_ID, trigger: r.TRIGGER_TYPE, by: r.REQUESTED_BY, status: r.STATUS, cancel: r.CANCEL_REQUESTED === 'Y', cycle: r.CYCLE_NO, read: r.ROWS_READ, written: r.ROWS_WRITTEN,
                    error: r.ERROR_TEXT, requested: r.REQUESTED, started: r.STARTED, ended: r.ENDED, secs: r.SECS };
            });
        }).catch(function () { return []; });
}
function plServer() { return psFind('server', PL.pipe && PL.pipe.serverId) || psDefaultServer(); }
function plConnName(id) { var c = psFind('conn', id); return c ? c.name : (id ? '#' + id : '—'); }

// ── schedule text ──────────────────────────────────────────────
function plEvery(secs) {
    secs = +secs || 0;
    if (!secs) return '—';
    if (secs % 86400 === 0) return secs / 86400 + ' day' + (secs === 86400 ? '' : 's');
    if (secs % 3600 === 0) return secs / 3600 + ' hour' + (secs === 3600 ? '' : 's');
    if (secs % 60 === 0) return secs / 60 + ' minute' + (secs === 60 ? '' : 's');
    return secs + ' seconds';
}
var PL_CRON_PRESETS = [
    ['*/15 * * * *', 'Every 15 minutes'], ['0 * * * *', 'Every hour'], ['0 */2 * * *', 'Every 2 hours'], ['0 2 * * *', 'Daily at 02:00'],
    ['30 7 * * 1-5', 'Weekdays at 07:30'], ['0 6 * * 1', 'Mondays at 06:00'], ['0 1 1 * *', 'Monthly on the 1st at 01:00']
];
function plCronText(expr) {
    var p = PL_CRON_PRESETS.filter(function (x) { return x[0] === String(expr).trim(); })[0];
    if (p) return p[1];
    var f = String(expr || '').trim().split(/\s+/);
    if (f.length !== 5) return 'cron "' + expr + '"';
    var hm = /^\d+$/.test(f[0]) && /^\d+$/.test(f[1]) ? ('0' + f[1]).slice(-2) + ':' + ('0' + f[0]).slice(-2) : null;
    if (hm && f[2] === '*' && f[3] === '*' && f[4] === '*') return 'Daily at ' + hm;
    if (hm && f[2] === '*' && f[3] === '*' && f[4] === '1-5') return 'Weekdays at ' + hm;
    return 'cron "' + expr + '"';
}
function plScheduleText(p) {
    if (p.schedule === 'INTERVAL') return 'Every ' + plEvery(p.interval);
    if (p.schedule === 'CRON') return plCronText(p.cron);
    if (p.schedule === 'CONTINUOUS') return 'Continuous — again and again' + (p.interval ? ', ' + plEvery(p.interval) + ' pause' : '') + ', until cancelled';
    return 'Manual — runs when you press Run now';
}
function plStatusChip(st) {
    var map = { SUCCESS: 'ds-st-ok', FAILED: 'ds-st-error', CANCELLED: 'ds-st-running', RUNNING: 'pl-st-run', QUEUED: 'pl-st-run', CANCEL_REQUESTED: 'ds-st-running', SKIPPED: 'ds-st-running' };
    var ic = { SUCCESS: 'fa-check', FAILED: 'fa-xmark', CANCELLED: 'fa-circle-stop', RUNNING: 'fa-spinner fa-spin', QUEUED: 'fa-hourglass-half', CANCEL_REQUESTED: 'fa-hourglass-half', SKIPPED: 'fa-forward' };
    return st ? '<span class="ds-st ' + (map[st] || 'ds-st-running') + '"><i class="fa-solid ' + (ic[st] || 'fa-circle') + '"></i> ' + esc(st === 'CANCEL_REQUESTED' ? 'Cancelling' : st.charAt(0) + st.slice(1).toLowerCase()) + '</span>' : '';
}
function plDur(s) { s = +s || 0; return s >= 3600 ? Math.floor(s / 3600) + 'h ' + Math.floor(s % 3600 / 60) + 'm' : s >= 60 ? Math.floor(s / 60) + 'm ' + (s % 60) + 's' : s + 's'; }

// ── render: list ───────────────────────────────────────────────
function plRenderList() {
    var el = $('pl-list'); if (!el) return;
    if (PL.state === 'loading' && !PL.list.length) { el.innerHTML = '<div class="ds-none">Loading…</div>'; return; }
    if (PL.state === 'offline') { el.innerHTML = '<div class="ds-none">APEX database not reachable.</div>'; return; }
    var term = (($('pl-search') || {}).value || '').toLowerCase();
    var list = PL.list.filter(function (p) { return !term || (p.name + ' ' + p.description).toLowerCase().indexOf(term) >= 0; });
    el.innerHTML = '<div class="ds-sec"><i class="fa-solid fa-diagram-successor"></i> Pipelines <span>' + list.length + '</span></div>' + (list.map(function (p) {
        var running = PL_ACTIVE.test(p.lastStatus || '');
        var dot = running ? 'running' : p.lastStatus === 'FAILED' ? 'error' : p.lastStatus === 'SUCCESS' ? '' : 'idle';
        return '<div class="ds-item' + (String(p.id) === String(PL.selId) ? ' sel' : '') + '" onclick="plSelect(' + parseInt(p.id, 10) + ')"><span class="ds-dot ' + dot + '"></span>' +
            '<div class="ds-item-body"><div class="ds-item-name">' + esc(p.name) + '</div>' +
            '<div class="ds-item-sub" style="font-size:.68rem;color:var(--fs-muted);">' + esc(plScheduleText(p)) + '</div>' +
            '<div class="ds-item-meta"><span><i class="fa-solid fa-list-ol"></i> ' + p.tasks + ' task' + (p.tasks === 1 ? '' : 's') + '</span>' +
            (p.lastRun ? '<span><i class="fa-regular fa-clock"></i> ' + esc(dsAgo(p.lastRun)) + '</span>' : '') +
            (p.schedule !== 'MANUAL' ? '<span class="ds-mode">' + (p.enabled ? 'ON' : 'OFF') + '</span>' : '') + '</div></div></div>';
    }).join('') || '<div class="ds-none">' + (PL.list.length ? 'No pipelines match.' : 'No pipelines yet.') + '</div>');
}

// ── render: main ───────────────────────────────────────────────
function plRenderMain() {
    var el = $('pl-main'); if (!el) return;
    if (PL.state === 'offline') { el.innerHTML = '<div class="fs-error-box">APEX database not reachable: ' + esc(PL.error) + ' <button class="fs-btn sm" onclick="plLoadList()">Retry</button></div>'; return; }
    if (PL.creating) { plRenderEditor(el, null); return; }
    if (!PL.pipe || String(PL.pipe.id) !== String(PL.selId)) {
        if (PL.state === 'ready' && !PL.list.length) {
            var ready = PS.servers.length && PS.conns.length;
            el.innerHTML = '<div class="ds-empty"><div class="ds-empty-icon"><i class="fa-solid fa-diagram-successor"></i></div><h3>Move data on a schedule</h3>' +
                '<ol><li>A <b>pipeline</b> runs one or more <b>tasks</b>: each task runs a SQL (Fusion, APEX or another database) and pushes the rows to a <b>target</b> table.</li>' +
                '<li>Choose how to load — append, replace, merge by key, or only what changed since the last run.</li>' +
                '<li>Schedule it every n minutes, by cron, or <b>continuously until you cancel it</b>. The pipeline server runs it — this PC can be off.</li></ol>' +
                (ready ? '' : '<div class="fl-banner stop" style="margin-bottom:12px;"><i class="fa-solid fa-circle-info"></i><div>First add the <b>pipeline server</b> and at least one <b>connection</b> in <a href="#" onclick="showTab(\'setups\');suSeg(\'pipe\');return false;">Setups › Data pipeline setups</a>.</div></div>') +
                '<div class="ds-empty-actions"><button class="fs-btn primary" onclick="plNew()"><i class="fa-solid fa-plus"></i> New pipeline</button></div></div>';
        } else el.innerHTML = '';
        return;
    }
    var P = PL.pipe, server = plServer(), last = PL.runs[0], active = last && PL_ACTIVE.test(last.status);
    el.innerHTML =
        '<div class="fs-card ds-detail">' +
        '<div class="ds-detail-head"><div style="min-width:0;"><div class="ds-detail-name"><i class="fa-solid fa-diagram-successor" style="color:var(--fs-red)"></i> ' + esc(P.name) + '</div>' +
        (P.description ? '<p class="ds-detail-desc" style="margin:4px 0 0;">' + esc(P.description) + '</p>' : '') + '</div>' +
        '<div class="ds-detail-badges">' + (last ? plStatusChip(last.status) : '<span class="fs-q-tag" style="background:#f1edea;color:#57504b;">never run</span>') + '</div></div>' +
        '<div class="pl-sched"><i class="fa-regular fa-calendar"></i><div><b>' + esc(plScheduleText(P)) + '</b>' +
        (P.schedule !== 'MANUAL' ? ' · schedule <b style="color:' + (P.enabled ? 'var(--fs-green)' : '#b45309') + '">' + (P.enabled ? 'ON' : 'OFF') + '</b>' : '') +
        (P.enabled && P.nextRun ? ' · next run ' + esc(P.nextRun) : '') + (P.timezone ? ' · ' + esc(P.timezone) : '') +
        '<div class="fs-muted" style="font-size:.74rem;">Runs on <b>' + esc(server ? server.name : 'no pipeline server') + '</b>' + (server ? ' (' + esc(server.status || 'not tested') + ')' : '') +
        ' · on error: ' + (P.onError === 'CONTINUE' ? 'continue with the next task' : 'stop the run') + '</div></div>' +
        (P.schedule !== 'MANUAL' ? '<label class="pl-switch" title="Schedule on/off"><input type="checkbox"' + (P.enabled ? ' checked' : '') + ' onchange="plToggle(this.checked)"><span></span></label>' : '') + '</div>' +
        '<div class="ds-toolbar">' +
        (active ? '<button class="fs-btn" onclick="plCancel(' + parseInt(last.id, 10) + ')"' + (last.cancel ? ' disabled' : '') + '><i class="fa-solid fa-circle-stop"></i> ' + (last.cancel ? 'Cancelling…' : 'Cancel run') + '</button>'
            : '<button class="fs-btn primary q-run-btn" onclick="plRunNow()"' + (PL.tasks.some(function (t) { return t.active; }) ? '' : ' disabled title="Add an active task first"') + '><i class="fa-solid fa-play"></i> Run now</button>') +
        '<button class="fs-btn" onclick="plEdit()"><i class="fa-solid fa-pen"></i> Edit pipeline</button>' +
        '<button class="fs-btn" onclick="plEditTask(null)"><i class="fa-solid fa-plus"></i> Add task</button>' +
        '<span style="flex:1"></span>' +
        '<button class="fs-icon-btn" title="Refresh status" onclick="plRefresh()"><i class="fa-solid fa-rotate"></i></button>' +
        '<button class="fs-icon-btn" title="Duplicate" onclick="plDuplicate()"><i class="fa-regular fa-clone"></i></button>' +
        '<button class="fs-icon-btn" title="Delete pipeline" onclick="plDelete()"><i class="fa-regular fa-trash-can"></i></button></div>' +
        (Object.keys(P.params).length ? '<div class="ds-params">' + Object.keys(P.params).map(function (k) { return '<span class="ds-param"><b>' + esc(k) + '</b> ' + esc(P.params[k]) + '</span>'; }).join('') + '</div>' : '') +
        '</div>' +
        '<div class="fs-card pl-tasks"><h3><i class="fa-solid fa-list-ol"></i> Tasks <small>' + PL.tasks.length + ' · run in this order</small></h3>' + plTasksHtml() + '</div>' +
        '<div class="fs-card pl-runs" id="pl-runs">' + plRunsHtml() + '</div>';
}
function plTasksHtml() {
    if (!PL.tasks.length) return '<div class="fs-muted" style="padding:6px 2px 4px;">No tasks yet — <a href="#" onclick="plEditTask(null);return false;">add the first task</a>: a SQL and the table it fills.</div>';
    var last = PL.runs[0], trun = {};
    if (PL.runDetail && last && PL.runDetail.runId === last.id) PL.runDetail.tasks.forEach(function (t) { trun[t.taskId] = t; });
    return PL.tasks.map(function (t, i) {
        var src = PL_SOURCES[t.sourceType] || PL_SOURCES.FUSION, tr = trun[t.id];
        var firstLine = t.sql.replace(/^\s*(--[^\n]*\n\s*)+/, '').split('\n')[0].slice(0, 110);
        return '<div class="pl-task' + (t.active ? '' : ' off') + '"><div class="pl-task-no">' + (i + 1) + '</div>' +
            '<div class="pl-task-body"><div class="pl-task-name">' + esc(t.name) + (t.active ? '' : ' <span class="fs-q-tag" style="background:#f1edea;color:#57504b;">inactive</span>') +
            (tr ? ' ' + plStatusChip(tr.status) + (tr.written != null ? ' <span class="fs-muted" style="font-size:.72rem;">' + (+tr.read || 0).toLocaleString() + ' read · ' + (+tr.written || 0).toLocaleString() + ' written</span>' : '') : '') + '</div>' +
            '<div class="pl-flowline"><span class="pl-src"><i class="fa-solid ' + src[1] + '"></i> ' + esc(t.sourceType === 'CONNECTION' ? plConnName(t.sourceConnId) : src[0]) + '</span>' +
            '<i class="fa-solid fa-arrow-right-long"></i><span class="pl-tgt"><i class="fa-solid fa-bullseye"></i> ' + esc(plConnName(t.targetConnId)) + ' › <code>' + esc(t.target) + '</code></span>' +
            '<span class="fs-q-tag" title="' + esc((PL_MODES[t.mode] || ['', ''])[1]) + '">' + esc((PL_MODES[t.mode] || [t.mode])[0]) + (t.mode === 'MERGE' && t.keys ? ' on ' + esc(t.keys) : '') + (t.mode === 'INCREMENTAL' && t.watermarkCol ? ' by ' + esc(t.watermarkCol) : '') + '</span></div>' +
            '<code class="pl-sql1">' + esc(firstLine) + (t.sql.split('\n').length > 1 ? ' …' : '') + '</code>' +
            (tr && tr.error ? '<div class="ds-err">' + esc(tr.error) + '</div>' : '') + '</div>' +
            '<div class="pl-task-act"><button class="fs-btn sm" onclick="plPreview(' + parseInt(t.id, 10) + ')" title="Run the source SQL here and show the first rows"><i class="fa-solid fa-eye"></i> Preview</button>' +
            '<button class="fs-btn sm" onclick="plEditTask(' + parseInt(t.id, 10) + ')"><i class="fa-solid fa-pen"></i> Edit</button>' +
            '<button class="fs-icon-btn" title="Move up" onclick="plMoveTask(' + i + ',-1)"><i class="fa-solid fa-arrow-up"></i></button>' +
            '<button class="fs-icon-btn" title="Move down" onclick="plMoveTask(' + i + ',1)"><i class="fa-solid fa-arrow-down"></i></button>' +
            '<button class="fs-icon-btn" title="Delete task" onclick="plDeleteTask(' + parseInt(t.id, 10) + ')"><i class="fa-regular fa-trash-can"></i></button></div></div>';
    }).join('');
}
function plRunsHtml() {
    var runs = PL.runs;
    var h = '<h3><i class="fa-solid fa-clock-rotate-left"></i> Runs <small>' + (PL.poll ? '<i class="fa-solid fa-circle pl-live"></i> live' : 'last ' + runs.length) + '</small></h3>';
    if (!runs.length) return h + '<div class="fs-muted">Not run yet.</div>';
    h += '<table class="ds-cols pl-runtable"><thead><tr><th>Run</th><th>Status</th><th>Trigger</th><th>Started</th><th>Duration</th><th class="n">Read</th><th class="n">Written</th><th></th></tr></thead><tbody>' +
        runs.map(function (r) {
            return '<tr class="' + (PL.runSel === r.id ? 'sel' : '') + '" onclick="plOpenRun(' + parseInt(r.id, 10) + ')"><td>#' + r.id + (r.cycle > 1 ? ' <span class="fs-muted">cycle ' + r.cycle + '</span>' : '') + '</td><td>' + plStatusChip(r.status) + '</td>' +
                '<td>' + esc((r.trigger || '').toLowerCase()) + (r.by ? ' <span class="fs-muted">· ' + esc(r.by) + '</span>' : '') + '</td><td>' + esc(r.started || r.requested || '') + '</td>' +
                '<td>' + (r.started ? plDur(r.secs) : '—') + '</td><td class="n">' + (+r.read || 0).toLocaleString() + '</td><td class="n">' + (+r.written || 0).toLocaleString() + '</td>' +
                '<td>' + (PL_ACTIVE.test(r.status) && !r.cancel ? '<button class="fs-btn sm" onclick="event.stopPropagation();plCancel(' + parseInt(r.id, 10) + ')"><i class="fa-solid fa-circle-stop"></i> Cancel</button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table>';
    var D = PL.runDetail;
    if (D && D.runId === PL.runSel) {
        var r = runs.filter(function (x) { return x.id === D.runId; })[0] || {};
        h += '<div class="pl-rundetail"><div class="pl-rd-head"><b>Run #' + D.runId + '</b> ' + plStatusChip(r.status) + (r.error ? '<div class="ds-err">' + esc(r.error) + '</div>' : '') + '</div>' +
            (D.tasks.length ? '<table class="ds-cols"><thead><tr><th>Task</th><th>Status</th><th>Duration</th><th class="n">Read</th><th class="n">Written</th><th>Watermark</th></tr></thead><tbody>' +
                D.tasks.map(function (t) {
                    var task = PL.tasks.filter(function (x) { return String(x.id) === String(t.taskId); })[0];
                    return '<tr><td>' + esc(task ? task.name : '#' + t.taskId) + (t.cycle > 1 ? ' <span class="fs-muted">c' + t.cycle + '</span>' : '') + (t.error ? '<div class="ds-err">' + esc(t.error) + '</div>' : '') + '</td><td>' + plStatusChip(t.status) + '</td>' +
                        '<td>' + plDur(t.secs) + '</td><td class="n">' + (+t.read || 0).toLocaleString() + '</td><td class="n">' + (+t.written || 0).toLocaleString() + '</td><td>' + esc(t.wmTo || '') + '</td></tr>';
                }).join('') + '</tbody></table>' : '<div class="fs-muted" style="margin:6px 0;">' + (PL_ACTIVE.test(r.status || '') ? 'Waiting for the pipeline server to start it…' : 'No task details recorded.') + '</div>') +
            (D.log.length ? '<div class="pl-log">' + D.log.map(function (l) { return '<div class="' + (l.level === 'ERROR' ? 'e' : l.level === 'WARN' ? 'w' : '') + '"><span>' + esc(l.time) + '</span> ' + esc(l.message) + '</div>'; }).join('') + '</div>' : '') + '</div>';
    }
    return h;
}

// ── runs: run now, cancel, live status ─────────────────────────
function plRunNow() {
    var P = PL.pipe, s = plServer(), user = appUserName();
    var queue = function (why) {
        return dbWrite("INSERT INTO wms_pipe_runs (pipeline_id, server_id, trigger_type, requested_by, status, params_json) VALUES (" + parseInt(P.id, 10) + ', ' +
            (s ? parseInt(s.id, 10) : 'NULL') + ", 'MANUAL', " + vlit(user, 120) + ", 'QUEUED', " + vlit(JSON.stringify(P.params || {}), 4000) + ')').then(function () {
                toast(why ? 'Pipeline server not reachable — the run is queued and starts when the server picks it up' : 'Run queued', why ? 'warn' : 'ok');
            });
    };
    var start = s ? psCall(s, '/pipelines/' + parseInt(P.id, 10) + '/run', 'POST', { params: P.params || {}, requested_by: user }).then(function (r) {
        if (!r || (!r.run_id && !r.ok)) throw (r && (r.detail || r.error || r.text)) || 'no run id';
        toast('Run #' + (r.run_id || '') + ' started on ' + s.name);
    }).catch(function (e) { return queue(String(e)); }) : queue('no server');
    start.then(plRefresh).catch(function (e) { toast('Could not start the run: ' + e, 'err'); });
}
function plCancel(runId) {
    var s = plServer();
    confirmModal('Cancel run #' + runId + '?', 'The pipeline server stops after the task that is running now; a continuous pipeline stops looping.', function () {
        dbWrite("UPDATE wms_pipe_runs SET cancel_requested = 'Y', status = CASE WHEN status = 'QUEUED' THEN 'CANCELLED' ELSE status END, " +
            "ended_date = CASE WHEN status = 'QUEUED' THEN SYSTIMESTAMP ELSE ended_date END WHERE run_id = " + parseInt(runId, 10))
            .then(function () { return s ? psCall(s, '/runs/' + parseInt(runId, 10) + '/cancel', 'POST', {}).catch(function () { }) : null; })
            .then(function () { toast('Cancel requested'); return plRefresh(); })
            .catch(function (e) { toast('Cancel failed: ' + e, 'err'); });
    });
}
function plOpenRun(runId) {
    PL.runSel = runId;
    return plReadRunDetail(runId).then(function () { var el = $('pl-runs'); if (el) el.innerHTML = plRunsHtml(); });
}
function plReadRunDetail(runId) {
    var rid = parseInt(runId, 10);
    return Promise.all([
        dbRead('SELECT task_id, cycle_no, status, rows_read, rows_written, watermark_to, error_text, ' +
            "ROUND((CAST(NVL(ended_date, SYSTIMESTAMP) AS DATE) - CAST(started_date AS DATE)) * 86400) AS secs FROM wms_pipe_task_runs WHERE run_id = " + rid + ' ORDER BY task_run_id', 200).catch(function () { return []; }),
        dbRead("SELECT TO_CHAR(log_time, 'HH24:MI:SS') AS t, log_level, message FROM wms_pipe_log WHERE run_id = " + rid + ' ORDER BY log_id DESC', 40).catch(function () { return []; })
    ]).then(function (res) {
        PL.runDetail = {
            runId: rid,
            tasks: res[0].map(function (t) { return { taskId: t.TASK_ID, cycle: t.CYCLE_NO, status: t.STATUS, read: t.ROWS_READ, written: t.ROWS_WRITTEN, wmTo: t.WATERMARK_TO, error: t.ERROR_TEXT, secs: t.SECS }; }),
            log: res[1].reverse().map(function (l) { return { time: l.T, level: l.LOG_LEVEL, message: l.MESSAGE }; })
        };
    });
}
function plRefresh() {
    if (!PL.pipe) return Promise.resolve();
    var pid = PL.pipe.id;
    return plReadRuns(pid).then(function (runs) {
        PL.runs = runs;
        var last = runs[0];
        if (last && (PL.runSel == null || PL_ACTIVE.test(last.status))) PL.runSel = last.id;
        return PL.runSel != null ? plReadRunDetail(PL.runSel) : null;
    }).then(function () {
        var f = PL.list.filter(function (p) { return String(p.id) === String(pid); })[0];
        if (f && PL.runs[0]) { f.lastStatus = PL.runs[0].status; f.lastRun = PL.runs[0].requested; }
        if (String(PL.selId) === String(pid)) { plRenderList(); plRenderMain(); }
        plAutoPoll();
    });
}
/** Polls every 3 s while a run of the open pipeline is queued or running, and only while the tab is open. */
function plAutoPoll() {
    var active = PL.runs[0] && PL_ACTIVE.test(PL.runs[0].status);
    var visible = $('page-pipelines') && $('page-pipelines').classList.contains('active');
    if (active && visible && !PL.poll) PL.poll = setInterval(function () { if (!document.hidden) plRefresh(); }, 3000);
    if ((!active || !visible) && PL.poll) { clearInterval(PL.poll); PL.poll = null; }
}

// ── pipeline editor ────────────────────────────────────────────
function plNew() { PL.creating = true; PL.selId = null; plRenderList(); plRenderMain(); }
function plEdit() { PL.creating = false; plRenderEditor($('pl-main'), PL.pipe); }
function plRenderEditor(el, P) {
    var server = (P && psFind('server', P.serverId)) || psDefaultServer();
    var n = P || { name: '', description: '', serverId: server && server.id, schedule: 'MANUAL', interval: 3600, cron: '0 2 * * *', timezone: server ? server.timezone : '', startDate: '', endDate: '', enabled: false, params: {}, onError: 'STOP', notify: '' };
    var unit = n.interval && n.interval % 3600 === 0 ? 3600 : n.interval && n.interval % 60 === 0 ? 60 : 1;
    el.innerHTML = '<div class="fs-card ds-detail"><div class="ds-detail-name"><i class="fa-solid fa-diagram-successor" style="color:var(--fs-red)"></i> ' + (P ? 'Edit pipeline' : 'New pipeline') + '</div>' +
        '<div class="ps-grid">' + psIn('pe-name', 'Pipeline name', n.name, 'maxlength="200" placeholder="e.g. AP invoices to DW"') +
        '<div class="ps-f"><label>Pipeline server</label><select id="pe-server">' + (PS.servers.map(function (s) { return '<option value="' + s.id + '"' + (server && String(server.id) === String(s.id) ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') || '<option value="">— add one in Setups —</option>') + '</select></div>' +
        '<div class="ps-f wide"><label for="pe-desc">Description</label><input id="pe-desc" maxlength="2000" value="' + esc(n.description) + '"></div></div>' +
        '<label class="ps-lab">Schedule</label><div class="ps-types pl-sched-types">' + [['MANUAL', 'Manual', 'fa-hand-pointer', 'Run now only'], ['INTERVAL', 'Every …', 'fa-repeat', 'minutes / hours'], ['CRON', 'At set times', 'fa-calendar-days', 'cron'], ['CONTINUOUS', 'Continuous', 'fa-infinity', 'until cancelled']].map(function (x) {
            return '<button class="ps-type' + (n.schedule === x[0] ? ' on' : '') + '" style="--c:#c74634" onclick="plSchedPick(\'' + x[0] + '\')" data-sched="' + x[0] + '"><i class="fa-solid ' + x[2] + '"></i><b>' + x[1] + '</b><small>' + x[3] + '</small></button>';
        }).join('') + '</div>' +
        '<div class="ps-grid" id="pe-sched-fields">' +
        '<div class="ps-f pe-int"><label>Every / pause</label><div class="ps-pw"><input id="pe-int" type="number" min="1" value="' + (n.interval ? n.interval / unit : 1) + '"><select id="pe-unit"><option value="60"' + (unit === 60 ? ' selected' : '') + '>minutes</option><option value="3600"' + (unit === 3600 ? ' selected' : '') + '>hours</option><option value="1"' + (unit === 1 ? ' selected' : '') + '>seconds</option></select></div></div>' +
        '<div class="ps-f pe-cron"><label>Cron (minute hour day month weekday)</label><div class="ps-pw"><input id="pe-cron" value="' + esc(n.cron) + '" oninput="$(\'pe-cron-txt\').textContent=plCronText(this.value)">' +
        '<select onchange="if(this.value){$(\'pe-cron\').value=this.value;$(\'pe-cron-txt\').textContent=plCronText(this.value);}"><option value="">presets…</option>' + PL_CRON_PRESETS.map(function (p) { return '<option value="' + p[0] + '">' + p[1] + '</option>'; }).join('') + '</select></div><small id="pe-cron-txt" class="fs-muted">' + esc(plCronText(n.cron)) + '</small></div>' +
        psIn('pe-tz', 'Timezone', n.timezone, 'placeholder="' + esc(server ? server.timezone : 'UTC') + '"', 'empty = server timezone') +
        psIn('pe-start', 'Start date (optional)', n.startDate, 'type="date"') + psIn('pe-end', 'End date (optional)', n.endDate, 'type="date"') + '</div>' +
        '<div class="ps-checks"><label class="pe-enabled"><input type="checkbox" id="pe-enabled"' + (n.enabled ? ' checked' : '') + '> Schedule is ON</label>' +
        '<label>If a task fails <select id="pe-onerr"><option value="STOP"' + (n.onError === 'STOP' ? ' selected' : '') + '>stop the run</option><option value="CONTINUE"' + (n.onError === 'CONTINUE' ? ' selected' : '') + '>continue with the next task</option></select></label></div>' +
        '<div class="ps-grid">' + psIn('pe-notify', 'Email on failure (optional)', n.notify, 'placeholder="name@company.com"') +
        '<div class="ps-f wide"><label for="pe-params">Parameters <small>one per line: <code>P_NAME = value</code> — used as {{P_NAME}} in task SQL</small></label><textarea id="pe-params" class="fs-db-sql" style="min-height:54px;">' +
        esc(Object.keys(n.params).map(function (k) { return k + ' = ' + n.params[k]; }).join('\n')) + '</textarea></div></div>' +
        '<div class="ds-toolbar"><button class="fs-btn primary" onclick="plSave(' + (P ? parseInt(P.id, 10) : 'null') + ')"><i class="fa-solid fa-floppy-disk"></i> Save</button>' +
        '<button class="fs-btn" onclick="' + (P ? 'plRenderMain()' : 'PL.creating=false;plLoadList()') + '">Cancel</button></div></div>';
    plSchedPick(n.schedule);
}
function plSchedPick(t) {
    document.querySelectorAll('.pl-sched-types .ps-type').forEach(function (b) { b.classList.toggle('on', b.dataset.sched === t); });
    PL.editSched = t;
    var show = function (sel, on) { document.querySelectorAll(sel).forEach(function (e) { e.style.display = on ? '' : 'none'; }); };
    show('.pe-int', t === 'INTERVAL' || t === 'CONTINUOUS');
    show('.pe-cron', t === 'CRON');
    var lab = document.querySelector('.pe-int label'); if (lab) lab.textContent = t === 'CONTINUOUS' ? 'Pause between cycles' : 'Every';
    var en = document.querySelector('.pe-enabled'); if (en) en.style.display = t === 'MANUAL' ? 'none' : '';
}
function plSave(id) {
    var name = psVal('pe-name'); if (!name) { toast('Give the pipeline a name', 'warn'); return; }
    var sched = PL.editSched || 'MANUAL', secs = (parseInt(psVal('pe-int'), 10) || 0) * (parseInt($('pe-unit').value, 10) || 60);
    if (sched === 'INTERVAL' && secs < 60) { toast('The interval must be at least 1 minute', 'warn'); return; }
    if (sched === 'CRON' && psVal('pe-cron').split(/\s+/).length !== 5) { toast('A cron needs 5 fields: minute hour day month weekday', 'warn'); return; }
    var params = {};
    $('pe-params').value.split('\n').forEach(function (l) { var m = /^\s*([A-Za-z_]\w*)\s*=\s*(.*?)\s*$/.exec(l); if (m) params[m[1].toUpperCase()] = m[2]; });
    var d = function (v) { return v ? "TO_DATE('" + v.replace(/[^0-9-]/g, '') + "','YYYY-MM-DD')" : 'NULL'; };
    var user = vlit(appUserName(), 120), sv = psVal('pe-server');
    var cols = { pipeline_name: vlit(name, 200), description: vlit(psVal('pe-desc'), 2000), server_id: sv ? parseInt(sv, 10) : 'NULL', schedule_type: vlit(sched, 20),
        interval_seconds: sched === 'INTERVAL' || sched === 'CONTINUOUS' ? secs : 'NULL', cron_expr: sched === 'CRON' ? vlit(psVal('pe-cron'), 100) : 'NULL', timezone: vlit(psVal('pe-tz'), 60),
        start_date: d(psVal('pe-start')), end_date: d(psVal('pe-end')), enabled: sched !== 'MANUAL' && $('pe-enabled').checked ? "'Y'" : "'N'", params_json: vlit(JSON.stringify(params), 4000),
        on_error: vlit($('pe-onerr').value, 10), notify_email: vlit(psVal('pe-notify'), 400) };
    plEnsureTables().then(function () {
        if (id) return dbWrite('UPDATE wms_pipelines SET ' + Object.keys(cols).map(function (k) { return k + ' = ' + cols[k]; }).join(', ') + ', updated_by = ' + user + ', updated_date = SYSDATE WHERE pipeline_id = ' + parseInt(id, 10));
        return dbWrite('INSERT INTO wms_pipelines (' + Object.keys(cols).join(', ') + ', created_by, created_date) VALUES (' + Object.keys(cols).map(function (k) { return cols[k]; }).join(', ') + ', ' + user + ', SYSDATE)');
    }).then(function () {
        return dbRead('SELECT pipeline_id FROM wms_pipelines WHERE UPPER(pipeline_name) = UPPER(' + vlit(name, 200) + ')', 1);
    }).then(function (r) {
        toast(id ? 'Pipeline saved' : 'Pipeline created — add its tasks');
        PL.creating = false; PL.selId = r[0] ? r[0].PIPELINE_ID : id;
        plNotifyServer();
        return plLoadList().then(function () { return plSelect(PL.selId); }).then(function () { if (!id) plEditTask(null); });
    }).catch(function (e) { toast('Save failed: ' + (/ORA-00001/.test(String(e)) ? 'a pipeline with this name already exists' : e), 'err'); });
}
function plToggle(on) {
    var P = PL.pipe;
    dbWrite("UPDATE wms_pipelines SET enabled = '" + (on ? 'Y' : 'N') + "', updated_by = " + vlit(appUserName(), 120) + ', updated_date = SYSDATE WHERE pipeline_id = ' + parseInt(P.id, 10))
        .then(function () { P.enabled = on; toast('Schedule ' + (on ? 'ON — the pipeline server runs it on schedule' : 'OFF')); plNotifyServer(); plRenderMain(); plLoadList(); })
        .catch(function (e) { toast('Could not change the schedule: ' + e, 'err'); });
}
/** Best effort: ask the server to re-read definitions now (otherwise it notices within its poll interval). */
function plNotifyServer() { var s = plServer(); if (s) psCall(s, '/reload', 'POST', {}).catch(function () { }); }
function plDuplicate() {
    var P = PL.pipe; if (!P) return;
    var base = P.name + ' (copy)', name = base, n = 2;
    while (PL.list.some(function (p) { return p.name.toUpperCase() === name.toUpperCase(); })) name = base + ' ' + n++;
    var user = vlit(appUserName(), 120);
    dbWrite('INSERT INTO wms_pipelines (pipeline_name, description, server_id, schedule_type, interval_seconds, cron_expr, timezone, enabled, params_json, on_error, notify_email, created_by, created_date) ' +
        'SELECT ' + vlit(name, 200) + ", description, server_id, schedule_type, interval_seconds, cron_expr, timezone, 'N', params_json, on_error, notify_email, " + user + ', SYSDATE FROM wms_pipelines WHERE pipeline_id = ' + parseInt(P.id, 10))
        .then(function () { return dbRead('SELECT pipeline_id FROM wms_pipelines WHERE UPPER(pipeline_name) = UPPER(' + vlit(name, 200) + ')', 1); })
        .then(function (r) {
            var nid = parseInt(r[0].PIPELINE_ID, 10);
            return dbWrite('INSERT INTO wms_pipe_tasks (pipeline_id, seq, task_name, source_type, source_conn_id, source_sql, target_conn_id, target_object, load_mode, key_columns, column_map_json, ' +
                'create_target, watermark_column, batch_size, row_limit, timeout_seconds, active, created_by, created_date) SELECT ' + nid + ', seq, task_name, source_type, source_conn_id, source_sql, ' +
                'target_conn_id, target_object, load_mode, key_columns, column_map_json, create_target, watermark_column, batch_size, row_limit, timeout_seconds, active, ' + user + ', SYSDATE ' +
                'FROM wms_pipe_tasks WHERE pipeline_id = ' + parseInt(P.id, 10)).then(function () { return nid; });
        })
        .then(function (nid) { toast('Duplicated as "' + name + '" (schedule OFF)'); PL.selId = nid; return plLoadList().then(function () { return plSelect(nid); }); })
        .catch(function (e) { toast('Duplicate failed: ' + e, 'err'); });
}
function plDelete() {
    var P = PL.pipe; if (!P) return;
    if (PL.runs[0] && PL_ACTIVE.test(PL.runs[0].status)) { toast('Cancel the running run first', 'warn'); return; }
    confirmModal('Delete pipeline "' + P.name + '"?', 'Removes the pipeline, its tasks and its run history. Target tables are not touched.', function () {
        var id = parseInt(P.id, 10);
        dbWrite('DELETE FROM wms_pipe_log WHERE run_id IN (SELECT run_id FROM wms_pipe_runs WHERE pipeline_id = ' + id + ')').catch(function () { })
            .then(function () { return dbWrite('DELETE FROM wms_pipe_task_runs WHERE run_id IN (SELECT run_id FROM wms_pipe_runs WHERE pipeline_id = ' + id + ')').catch(function () { }); })
            .then(function () { return dbWrite('DELETE FROM wms_pipe_runs WHERE pipeline_id = ' + id); })
            .then(function () { return dbWrite('DELETE FROM wms_pipe_tasks WHERE pipeline_id = ' + id); })
            .then(function () { return dbWrite('DELETE FROM wms_pipelines WHERE pipeline_id = ' + id); })
            .then(function () { toast('Pipeline deleted'); PL.selId = null; PL.pipe = null; plNotifyServer(); return plLoadList(); })
            .catch(function (e) { toast('Delete failed: ' + e, 'err'); });
    });
}

// ── task editor ────────────────────────────────────────────────
function plConnOptions(sel, emptyLabel) {
    return (emptyLabel ? '<option value="">' + emptyLabel + '</option>' : '') + PS.conns.filter(function (c) { return c.active || String(c.id) === String(sel); }).map(function (c) {
        return '<option value="' + c.id + '"' + (String(c.id) === String(sel) ? ' selected' : '') + '>' + esc(c.name) + ' — ' + esc((PS_TYPES[c.type] || { label: c.type }).label) + '</option>';
    }).join('');
}
function plEditTask(taskId, prefillSql) {
    var P = PL.pipe; if (!P) return;
    if (!PS.conns.length) { toast('Add a target connection first (Setups › Data pipeline setups)', 'warn'); showTab('setups'); suSeg('pipe'); return; }
    var t = taskId ? PL.tasks.filter(function (x) { return String(x.id) === String(taskId); })[0] : null;
    var n = t || { name: '', sourceType: 'FUSION', sourceConnId: '', sql: prefillSql || '', targetConnId: (PS.conns[0] || {}).id, target: '', mode: 'APPEND', keys: '', createTarget: true, watermarkCol: '', batch: 5000, rowLimit: '', timeout: 900, active: true };
    openModal(t ? 'Edit task — ' + t.name : 'Add task',
        '<div class="fs-form fl-form">' +
        '<div class="fl-form-row"><div><label>Task name</label><input id="pt-name" maxlength="200" value="' + esc(n.name) + '" placeholder="e.g. Load open AP invoices"></div>' +
        '<div style="max-width:250px;"><label>Source</label><select id="pt-src" onchange="$(\'pt-srcconn-w\').style.display=this.value===\'CONNECTION\'?\'\':\'none\'">' +
        Object.keys(PL_SOURCES).map(function (k) { return '<option value="' + k + '"' + (n.sourceType === k ? ' selected' : '') + '>' + PL_SOURCES[k][0] + '</option>'; }).join('') + '</select></div>' +
        '<div id="pt-srcconn-w" style="max-width:260px;' + (n.sourceType === 'CONNECTION' ? '' : 'display:none;') + '"><label>Source connection</label><select id="pt-srcconn">' + plConnOptions(n.sourceConnId, '— choose —') + '</select></div></div>' +
        '<label>Source SQL <small>parameters <code>{{P_NAME}}</code>; for incremental loads <code>{{WATERMARK}}</code> = the last value loaded, e.g. <code>WHERE last_update_date &gt; {{WATERMARK}}</code></small>' +
        '<button class="fs-btn sm" style="float:right;margin-top:-4px;" onclick="$(\'pt-sql\').value=getSql();" title="Copy the SQL from the SQL Builder"><i class="fa-solid fa-code"></i> Use SQL Builder SQL</button></label>' +
        '<textarea id="pt-sql" class="fs-db-sql fl-sql-edit" spellcheck="false">' + esc(n.sql) + '</textarea>' +
        '<div class="fl-form-row"><div><label>Target connection</label><select id="pt-tgt">' + plConnOptions(n.targetConnId) + '</select></div>' +
        '<div><label>Target table / endpoint</label><input id="pt-obj" maxlength="400" value="' + esc(n.target) + '" placeholder="e.g. DW.AP_INVOICES or /wms/v1/invoices"></div></div>' +
        '<label>Load mode</label><div class="pl-modes">' + Object.keys(PL_MODES).map(function (k) {
            return '<label class="fs-radio"><input type="radio" name="pt-mode" value="' + k + '"' + (n.mode === k ? ' checked' : '') + ' onchange="plModeFields()"><span><b>' + PL_MODES[k][0] + '</b><small>' + PL_MODES[k][1] + '</small></span></label>';
        }).join('') + '</div>' +
        '<div class="fl-form-row"><div id="pt-keys-w"><label>Key columns <small>comma separated</small></label><input id="pt-keys" value="' + esc(n.keys) + '" placeholder="e.g. INVOICE_ID"></div>' +
        '<div id="pt-wm-w"><label>Watermark column</label><input id="pt-wm" value="' + esc(n.watermarkCol) + '" placeholder="e.g. LAST_UPDATE_DATE"></div></div>' +
        '<div class="fl-form-row"><div><label>Batch size</label><input id="pt-batch" type="number" min="100" value="' + esc(n.batch) + '"></div>' +
        '<div><label>Row limit per run <small>optional</small></label><input id="pt-limit" type="number" min="1" value="' + esc(n.rowLimit || '') + '"></div>' +
        '<div><label>Timeout (seconds)</label><input id="pt-timeout" type="number" min="30" value="' + esc(n.timeout) + '"></div></div>' +
        '<div class="ps-checks"><label><input type="checkbox" id="pt-create"' + (n.createTarget ? ' checked' : '') + '> Create the target table if it does not exist</label>' +
        '<label><input type="checkbox" id="pt-active"' + (n.active ? ' checked' : '') + '> Active</label></div>' +
        (t && t.watermark ? '<p class="fs-muted" style="font-size:.76rem;">Last watermark: <code>' + esc(t.watermark) + '</code> <a href="#" onclick="plResetWatermark(' + parseInt(t.id, 10) + ');return false;">reset (reload everything next run)</a></p>' : '') +
        '<div id="pt-msg" class="fl-test"></div></div>',
        [{ label: '<i class="fa-solid fa-eye"></i> Preview', cls: 'ghost', onClick: function () { plPreviewSql($('pt-src').value, $('pt-sql').value, $('pt-msg')); } },
        { label: 'Cancel', cls: 'ghost', onClick: closeModal },
        { label: '<i class="fa-solid fa-floppy-disk"></i> Save', cls: 'primary', onClick: function () { plSaveTask(t, this); } }], true);
    plModeFields();
    setTimeout(function () { (t ? $('pt-sql') : $('pt-name')).focus(); }, 30);
}
function plModeFields() {
    var m = (document.querySelector('input[name="pt-mode"]:checked') || {}).value;
    $('pt-keys-w').style.visibility = m === 'MERGE' || m === 'INCREMENTAL' ? '' : 'hidden';
    $('pt-wm-w').style.visibility = m === 'INCREMENTAL' ? '' : 'hidden';
}
function plSaveTask(t, btn) {
    var P = PL.pipe, msg = $('pt-msg');
    var v = { name: psVal('pt-name'), src: $('pt-src').value, srcConn: $('pt-srcconn').value, sql: $('pt-sql').value.trim().replace(/;\s*$/, ''), tgt: $('pt-tgt').value, obj: psVal('pt-obj'),
        mode: (document.querySelector('input[name="pt-mode"]:checked') || {}).value || 'APPEND', keys: psVal('pt-keys').toUpperCase(), wm: psVal('pt-wm').toUpperCase(),
        batch: parseInt(psVal('pt-batch'), 10) || 5000, limit: parseInt(psVal('pt-limit'), 10) || null, timeout: parseInt(psVal('pt-timeout'), 10) || 900 };
    var err = !v.name ? 'Give the task a name.' : !flIsSelect(v.sql) ? 'The source SQL must be a query (SELECT … or WITH …).' : !v.tgt ? 'Choose the target connection.' :
        !v.obj ? 'Enter the target table (or endpoint).' : v.src === 'CONNECTION' && !v.srcConn ? 'Choose the source connection.' :
            (v.mode === 'MERGE' && !v.keys) ? 'Merge needs key columns.' : (v.mode === 'INCREMENTAL' && !v.wm) ? 'Incremental loads need a watermark column.' :
                (v.mode === 'INCREMENTAL' && !/\{\{\s*WATERMARK\s*\}\}/i.test(v.sql)) ? 'Use {{WATERMARK}} in the SQL so only new rows are read (e.g. WHERE last_update_date > {{WATERMARK}}).' : null;
    if (err) { msg.innerHTML = '<div class="fs-error-box">' + esc(err) + '</div>'; return; }
    if (v.sql.length > SQL_PIECE * SQL_PIECES) { msg.innerHTML = '<div class="fs-error-box">The SQL is too long (' + v.sql.length + ' characters, limit ' + SQL_PIECE * SQL_PIECES + ').</div>'; return; }
    var user = vlit(appUserName(), 120), seq = t ? t.seq : (PL.tasks.reduce(function (m, x) { return Math.max(m, x.seq || 0); }, 0) + 1);
    var cols = { task_name: vlit(v.name, 200), source_type: vlit(v.src, 20), source_conn_id: v.src === 'CONNECTION' ? parseInt(v.srcConn, 10) : 'NULL', source_sql: clobLit(v.sql),
        target_conn_id: parseInt(v.tgt, 10), target_object: vlit(v.obj, 400), load_mode: vlit(v.mode, 20), key_columns: vlit(v.keys, 1000), watermark_column: vlit(v.wm, 128),
        create_target: $('pt-create').checked ? "'Y'" : "'N'", batch_size: v.batch, row_limit: v.limit || 'NULL', timeout_seconds: v.timeout, active: $('pt-active').checked ? "'Y'" : "'N'" };
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';
    (t ? dbWrite('UPDATE wms_pipe_tasks SET ' + Object.keys(cols).map(function (k) { return k + ' = ' + cols[k]; }).join(', ') + ', updated_by = ' + user + ', updated_date = SYSDATE WHERE task_id = ' + parseInt(t.id, 10))
        : dbWrite('INSERT INTO wms_pipe_tasks (pipeline_id, seq, ' + Object.keys(cols).join(', ') + ', created_by, created_date) VALUES (' + parseInt(P.id, 10) + ', ' + seq + ', ' +
            Object.keys(cols).map(function (k) { return cols[k]; }).join(', ') + ', ' + user + ', SYSDATE)'))
        .then(function () {
            // read the SQL back: the database must hold exactly what was typed
            var pieces = []; for (var i = 0; i < SQL_PIECES; i++) pieces.push('TO_CHAR(SUBSTR(source_sql, ' + (i * SQL_PIECE + 1) + ', ' + SQL_PIECE + ')) AS p' + i);
            return dbRead('SELECT task_id, ' + pieces.join(', ') + ' FROM wms_pipe_tasks WHERE pipeline_id = ' + parseInt(P.id, 10) + ' AND ' +
                (t ? 'task_id = ' + parseInt(t.id, 10) : 'seq = ' + seq + ' ORDER BY task_id DESC'), 1);
        }).then(function (r) {
            var got = ''; if (r[0]) for (var i = 0; i < SQL_PIECES; i++) got += r[0]['P' + i] || '';
            if (!r[0] || flNormSql(got) !== flNormSql(v.sql)) throw 'the database did not keep the SQL';
            closeModal(); toast(t ? 'Task saved' : 'Task added'); plNotifyServer();
            return plLoadPipe(PL.pipe.id).then(function () { plRenderMain(); plLoadList(); });
        }).catch(function (e) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save'; msg.innerHTML = '<div class="fs-error-box">Not saved: ' + esc(e) + '</div>'; });
}
function plResetWatermark(taskId) {
    dbWrite('UPDATE wms_pipe_tasks SET last_watermark = NULL WHERE task_id = ' + parseInt(taskId, 10))
        .then(function () { toast('Watermark cleared — the next run loads everything'); closeModal(); return plLoadPipe(PL.pipe.id).then(plRenderMain); })
        .catch(function (e) { toast('Could not reset: ' + e, 'err'); });
}
function plMoveTask(i, dir) {
    var j = i + dir, a = PL.tasks[i], b = PL.tasks[j]; if (!a || !b) return;
    dbWrite('UPDATE wms_pipe_tasks SET seq = ' + (j + 1) + ' WHERE task_id = ' + parseInt(a.id, 10))
        .then(function () { return dbWrite('UPDATE wms_pipe_tasks SET seq = ' + (i + 1) + ' WHERE task_id = ' + parseInt(b.id, 10)); })
        .then(function () { plNotifyServer(); return plLoadPipe(PL.pipe.id).then(plRenderMain); })
        .catch(function (e) { toast('Could not move the task: ' + e, 'err'); });
}
function plDeleteTask(taskId) {
    var t = PL.tasks.filter(function (x) { return String(x.id) === String(taskId); })[0]; if (!t) return;
    confirmModal('Delete task "' + t.name + '"?', 'The target table is not touched.', function () {
        dbWrite('DELETE FROM wms_pipe_tasks WHERE task_id = ' + parseInt(taskId, 10))
            .then(function () { toast('Task deleted'); plNotifyServer(); return plLoadPipe(PL.pipe.id).then(function () { plRenderMain(); plLoadList(); }); })
            .catch(function (e) { toast('Delete failed: ' + e, 'err'); });
    });
}

// ── preview a task's source rows (runs here: Fusion via the runner, APEX via executequery) ──
function plPreviewSql(src, sql, out) {
    var P = PL.pipe || { params: {} };
    var vals = Object.assign({ WATERMARK: '' }, P.params || {});
    var text = substituteParams(sql, vals);
    if (src === 'CONNECTION') { out.innerHTML = '<div class="fs-muted">Preview for another connection runs on the pipeline server — save the task, then use Preview on the task list.</div>'; return; }
    out.innerHTML = '<span class="fs-spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span> Running the source SQL…';
    var run = src === 'APEX'
        ? apexPost('/executequery', { sql: text, maxRows: 20 }).then(function (d) { var x = dsShape(d); return { columns: x.cols, rows: x.rows }; })
        : fsql(text, 20);
    run.then(function (r) {
        out.innerHTML = '<div class="fl-test-ok"><i class="fa-solid fa-circle-check"></i> ' + r.rows.length + ' row(s) shown (first 20)</div><div class="fs-grid small" id="pt-prev" style="max-height:260px;"></div>';
        renderSimpleGrid($('pt-prev'), r.columns || [], r.rows || []);
    }).catch(function (e) { out.innerHTML = '<div class="fs-error-box">' + esc(e) + '</div>'; });
}
function plPreview(taskId) {
    var t = PL.tasks.filter(function (x) { return String(x.id) === String(taskId); })[0]; if (!t) return;
    openModal('Preview — ' + t.name, '<div id="pv-out"></div>', [{ label: 'Close', cls: 'primary', onClick: closeModal }], true);
    if (t.sourceType === 'CONNECTION') {
        var s = plServer(), out = $('pv-out');
        if (!s) { out.innerHTML = '<div class="fs-error-box">No pipeline server.</div>'; return; }
        out.innerHTML = '<span class="fs-spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span> Asking ' + esc(s.name) + '…';
        psCall(s, '/pipelines/' + parseInt(PL.pipe.id, 10) + '/preview', 'POST', { task_id: t.id, limit: 20 }).then(function (r) {
            var rows = (r && r.rows) || [], cols = (r && r.columns) || (rows[0] ? Object.keys(rows[0]) : []);
            out.innerHTML = '<div class="fs-grid small" id="pt-prev"></div>'; renderSimpleGrid($('pt-prev'), cols, rows);
        }).catch(function (e) { out.innerHTML = '<div class="fs-error-box">Pipeline server: ' + esc(e) + '</div>'; });
        return;
    }
    plPreviewSql(t.sourceType, t.sql, $('pv-out'));
}
/** SQL Builder › "Add to pipeline": opens the task editor with the editor's SQL. */
function plAddFromBuilder() {
    var sql = getSql().trim();
    if (!sql) { toast('Write a query first', 'warn'); return; }
    showTab('pipelines');
    var go = function () {
        if (!PL.pipe) { toast('Create or open a pipeline, then add the task', 'warn'); if (!PL.list.length) plNew(); return; }
        plEditTask(null, sql);
    };
    setTimeout(function () { (PL.state === 'ready' ? Promise.resolve() : plLoadList()).then(go); }, 50);
}
