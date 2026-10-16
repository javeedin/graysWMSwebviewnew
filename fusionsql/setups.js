/* ═══════════════════════════════════════════════════════════════
   Fusion SQL — Fusion Setups (module-wise setup checklist)

   WMS_FUSION_SETUP_TASKS   : module, task, check SQL (APEX DB)
   WMS_FUSION_SETUP_RESULTS : last result per task and pod (PROD/TEST)
   (apex_sql/65_fusion_setup_checklist.sql — auto-created by the page)

   A check runs  SELECT COUNT(*) FROM (<check SQL>)  on Fusion through the
   same BIP runner as the SQL Builder; DONE when count >= min_rows. The
   same SQL drills down into the configured records.
   ═══════════════════════════════════════════════════════════════ */

var SU = {
    state: 'loading',          // loading | ready | missing | offline
    error: null,
    tasks: [],
    module: null,              // selected module code (null = first)
    filter: 'all',             // all | missing | error | unchecked | done
    running: {},               // task_id -> true while checking
    batch: null,               // { total, done, stop }
    drill: null                // { task, columns, rows }
};
var SU_TASKS = 'wms_fusion_setup_tasks', SU_RESULTS = 'wms_fusion_setup_results';
var SU_DDL = [
    'CREATE TABLE wms_fusion_setup_tasks (task_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, task_code VARCHAR2(60) NOT NULL, ' +
    'module_code VARCHAR2(20) NOT NULL, module_name VARCHAR2(100), seq NUMBER DEFAULT 100, task_name VARCHAR2(300) NOT NULL, ' +
    'description VARCHAR2(2000), fsm_task VARCHAR2(300), check_sql CLOB NOT NULL, min_rows NUMBER DEFAULT 1, ' +
    "mandatory VARCHAR2(1) DEFAULT 'Y', active VARCHAR2(1) DEFAULT 'Y', source VARCHAR2(10) DEFAULT 'USER', created_by VARCHAR2(120), " +
    'created_date DATE DEFAULT SYSDATE, updated_by VARCHAR2(120), updated_date DATE)',
    'CREATE UNIQUE INDEX wms_fusion_setup_tasks_code_ux ON wms_fusion_setup_tasks (task_code)',
    'CREATE TABLE wms_fusion_setup_results (task_id NUMBER NOT NULL, instance VARCHAR2(10) NOT NULL, status VARCHAR2(10), ' +
    'row_count NUMBER, checked_date DATE, checked_by VARCHAR2(120), elapsed_ms NUMBER, error_text VARCHAR2(4000), ' +
    'CONSTRAINT wms_fusion_setup_results_pk PRIMARY KEY (task_id, instance))'
];

function suModuleName(code) {
    var m = (window.FS_SETUP_MODULES || []).filter(function (x) { return x[0] === code; })[0];
    if (m) return m[1];
    var t = SU.tasks.filter(function (x) { return x.module === code && x.moduleName; })[0];
    return t ? t.moduleName : code;
}
function suModuleOrder(code) {
    var i = (window.FS_SETUP_MODULES || []).map(function (x) { return x[0]; }).indexOf(code);
    return i < 0 ? 100 : i;
}

// ── Tables & starter checklist ────────────────────────────────
function suCreateTables() {
    return dbRead("SELECT table_name FROM user_tables WHERE table_name IN ('WMS_FUSION_SETUP_TASKS','WMS_FUSION_SETUP_RESULTS')", 5).then(function (r) {
        var have = {}; r.forEach(function (x) { have[x.TABLE_NAME] = 1; });
        var todo = [];
        if (!have.WMS_FUSION_SETUP_TASKS) todo.push(SU_DDL[0], SU_DDL[1]);
        if (!have.WMS_FUSION_SETUP_RESULTS) todo.push(SU_DDL[2]);
        return todo.reduce(function (p, ddl) { return p.then(function () { return dbWrite(ddl); }); }, Promise.resolve());
    });
}
/** Inserts starter tasks whose task_code is not in the table yet (never overwrites edits). */
function suLoadStarter() {
    var seed = window.FS_SETUP_SEED || [];
    var btn = $('su-starter-btn'); if (btn) btn.disabled = true;
    var done = 0;
    suStatus('<span class="fs-spinner su-spin"></span> Creating tables…');
    return suCreateTables().then(function () {
        return seed.reduce(function (p, s) {
            return p.then(function () {
                var sql = 'INSERT INTO ' + SU_TASKS + ' (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by, created_date) ' +
                    'SELECT ' + lit(s[1]) + ', ' + lit(s[0]) + ', ' + vlit(suModuleName(s[0]), 100) + ', ' + s[2] + ', ' + vlit(s[3], 300) + ', ' + vlit(s[4], 300) + ', ' +
                    vlit(s[5], 2000) + ', ' + clobLit(s[6]) + ', ' + lit(s[7]) + ', ' + s[8] + ", 'STARTER', " + vlit(appUserName(), 120) + ', SYSDATE FROM dual ' +
                    'WHERE NOT EXISTS (SELECT 1 FROM ' + SU_TASKS + ' WHERE task_code = ' + lit(s[1]) + ')';
                return dbWrite(sql).then(function () {
                    done++;
                    suStatus('<span class="fs-spinner su-spin"></span> Loading starter checklist… ' + done + ' / ' + seed.length);
                });
            });
        }, Promise.resolve());
    }).then(function () {
        toast('Starter checklist loaded (' + seed.length + ' tasks)');
        return suLoad();
    }).catch(function (e) {
        toast('Could not load the checklist: ' + e, 'err');
        if (btn) btn.disabled = false;
        return suLoad();
    });
}

// ── Load ───────────────────────────────────────────────────────
function suLoad() {
    if (SU.state !== 'ready') SU.state = 'loading';
    suRender();
    var pieces = [];
    for (var i = 0; i < SQL_PIECES; i++) pieces.push('TO_CHAR(SUBSTR(t.check_sql, ' + (i * SQL_PIECE + 1) + ', ' + SQL_PIECE + ')) AS p' + i);
    var sql = 'SELECT t.task_id, t.task_code, t.module_code, t.module_name, t.seq, t.task_name, t.description, t.fsm_task, t.min_rows, t.mandatory, t.active, t.source, ' +
        "r.status, r.row_count, TO_CHAR(r.checked_date, 'YYYY-MM-DD HH24:MI') AS checked, r.checked_by, r.elapsed_ms, r.error_text, " + pieces.join(', ') +
        ' FROM ' + SU_TASKS + ' t LEFT JOIN ' + SU_RESULTS + ' r ON r.task_id = t.task_id AND r.instance = ' + lit(currentInstance()) +
        ' ORDER BY t.module_code, t.seq, t.task_id';
    return dbRead(sql, 5000).then(function (rows) {
        SU.state = 'ready'; SU.error = null;
        SU.tasks = rows.map(function (r) {
            var text = '';
            for (var i = 0; i < SQL_PIECES; i++) text += r['P' + i] || '';
            return {
                id: r.TASK_ID, code: r.TASK_CODE, module: r.MODULE_CODE, moduleName: r.MODULE_NAME, seq: r.SEQ, name: r.TASK_NAME,
                description: r.DESCRIPTION || '', fsm: r.FSM_TASK || '', minRows: r.MIN_ROWS == null ? 1 : +r.MIN_ROWS,
                mandatory: r.MANDATORY !== 'N', active: r.ACTIVE !== 'N', source: r.SOURCE, sql: text,
                status: r.STATUS || null, count: r.ROW_COUNT, checked: r.CHECKED, checkedBy: r.CHECKED_BY, ms: r.ELAPSED_MS, error: r.ERROR_TEXT
            };
        });
    }).catch(function (e) {
        SU.error = String(e);
        SU.state = /ORA-00942|table or view does not exist/i.test(SU.error) ? 'missing' : 'offline';
        SU.tasks = [];
    }).then(function () { suRender(); return SU.tasks; });
}

// ── Check engine ───────────────────────────────────────────────
/** Runs the task's check SQL as a COUNT on Fusion and stores the result for this pod. */
function suCheck(t) {
    if (SU.running[t.id]) return Promise.resolve();
    SU.running[t.id] = true; suRenderTasks();
    var t0 = Date.now(), sql = suResolveParams(t.sql);
    var countSql = 'SELECT COUNT(*) AS cnt FROM (\n' + sql + '\n)';
    return fsql(countSql, 1).then(function (r) {
        var n = r.rows.length ? +r.rows[0].CNT : 0;
        return { status: n >= (t.minRows || 1) ? 'DONE' : 'MISSING', count: n, error: null };
    }, function (e) {
        return { status: 'ERROR', count: null, error: String(e).split('\n').slice(0, 3).join(' ') };
    }).then(function (res) {
        var ms = Date.now() - t0;
        t.status = res.status; t.count = res.count; t.error = res.error; t.ms = ms;
        t.checked = new Date().toISOString().slice(0, 16).replace('T', ' '); t.checkedBy = appUserName();
        var vals = lit(res.status) + ', ' + (res.count == null ? 'NULL' : res.count) + ', SYSDATE, ' + vlit(appUserName(), 120) + ', ' + ms + ', ' + vlit(res.error ? res.error.slice(0, 3900) : '', 4000);
        return dbWrite('MERGE INTO ' + SU_RESULTS + ' r USING (SELECT ' + parseInt(t.id, 10) + ' AS task_id, ' + lit(currentInstance()) + ' AS instance FROM dual) s ' +
            'ON (r.task_id = s.task_id AND r.instance = s.instance) ' +
            'WHEN MATCHED THEN UPDATE SET r.status = ' + lit(res.status) + ', r.row_count = ' + (res.count == null ? 'NULL' : res.count) +
            ', r.checked_date = SYSDATE, r.checked_by = ' + vlit(appUserName(), 120) + ', r.elapsed_ms = ' + ms + ', r.error_text = ' + vlit(res.error ? res.error.slice(0, 3900) : '', 4000) + ' ' +
            'WHEN NOT MATCHED THEN INSERT (task_id, instance, status, row_count, checked_date, checked_by, elapsed_ms, error_text) VALUES (s.task_id, s.instance, ' + vals + ')')
            .catch(function (e) { toast('Result not saved to APEX: ' + e, 'warn'); });
    }).then(function () { delete SU.running[t.id]; suRender(); });
}
/** {{PARAM}} / :BIND in a check SQL use the last values entered in the SQL Builder (blank = NULL). */
function suResolveParams(sql) {
    var names = detectParams(sql);
    if (!names.length) return sql;
    var saved = lsGet('fusionSql.params', {}), vals = {};
    names.forEach(function (n) { vals[n] = saved[n.toUpperCase()] != null ? saved[n.toUpperCase()] : ''; });
    return substituteParams(sql, vals);
}
/** Checks a list of tasks one after another (each is a BIP job on the pod). */
function suCheckMany(list) {
    if (SU.batch) { toast('Checks are already running', 'warn'); return; }
    list = list.filter(function (t) { return t.active; });
    if (!list.length) { toast('Nothing to check', 'warn'); return; }
    SU.batch = { total: list.length, done: 0, stop: false };
    suRender();
    var next = function (i) {
        if (i >= list.length || SU.batch.stop) return Promise.resolve();
        return suCheck(list[i]).then(function () { SU.batch.done++; suRenderBatch(); return next(i + 1); });
    };
    next(0).then(function () {
        var stopped = SU.batch.stop, n = SU.batch.done;
        SU.batch = null; suRender();
        var miss = list.filter(function (t) { return t.status === 'MISSING'; }).length, err = list.filter(function (t) { return t.status === 'ERROR'; }).length;
        toast((stopped ? 'Stopped after ' : 'Checked ') + n + ' task' + (n === 1 ? '' : 's') + ' · ' + miss + ' not done · ' + err + ' errors', err ? 'warn' : 'ok');
    });
}
function suStop() { if (SU.batch) SU.batch.stop = true; }
function suCheckModule() { suCheckMany(SU.tasks.filter(function (t) { return t.module === SU.module; })); }
function suCheckAll() {
    confirmModal('Run all ' + SU.tasks.filter(function (t) { return t.active; }).length + ' checks?', 'Each check is one query on ' + currentInstance() + ' (about 1–3 s each); they run one after another. You can stop at any time.', function () {
        suCheckMany(SU.tasks.slice().sort(function (a, b) { return suModuleOrder(a.module) - suModuleOrder(b.module) || a.seq - b.seq; }));
    });
}
function suCheckOne(id) { var t = suTask(id); if (t) suCheck(t); }
function suTask(id) { return SU.tasks.filter(function (t) { return t.id === id; })[0]; }

// ── Drill-down ─────────────────────────────────────────────────
function suDrill(id) {
    var t = suTask(id); if (!t) return;
    openModal(t.name,
        '<div class="su-drill-head"><span class="fs-chip muted">' + esc(suModuleName(t.module)) + '</span>' + (t.fsm ? '<span class="fs-chip muted">FSM: ' + esc(t.fsm) + '</span>' : '') +
        '<span class="fs-muted" id="su-drill-meta">Running on ' + esc(currentInstance()) + '…</span></div>' +
        '<details class="fs-details" style="margin:6px 0 10px;"><summary>Check SQL</summary><div class="fs-code-box"><pre>' + esc(t.sql) + '</pre></div></details>' +
        '<div class="fs-grid small" id="su-drill-grid"><div class="fs-empty" style="min-height:140px;"><div class="fs-spinner"></div></div></div>',
        [{ label: '<i class="fa-solid fa-file-excel"></i> Excel', cls: '', onClick: function () { suDrillExport(); } },
        { label: '<i class="fa-solid fa-code"></i> Open in SQL Builder', cls: '', onClick: function () { closeModal(); setCurrentQuery(null); setSql(t.sql); showTab('builder'); } },
        { label: 'Close', cls: 'primary', onClick: closeModal }], true);
    var t0 = Date.now();
    fsql(suResolveParams(t.sql), 1000).then(function (r) {
        SU.drill = { task: t, columns: r.columns, rows: r.rows };
        var m = $('su-drill-meta'); if (m) m.textContent = r.rowCount.toLocaleString() + ' row' + (r.rowCount === 1 ? '' : 's') + (r.capped ? ' (first 1,000)' : '') + ' · ' + fmtMs(Date.now() - t0);
        var g = $('su-drill-grid'); if (g) renderSimpleGrid(g, r.columns, r.rows);
    }).catch(function (e) {
        var g = $('su-drill-grid'); if (g) g.innerHTML = '<div class="fs-error-box" style="margin:10px;">' + esc(e) + '</div>';
        var m = $('su-drill-meta'); if (m) m.textContent = '';
    });
}
function suDrillExport() {
    var D = SU.drill;
    if (!D || !D.rows.length || typeof ExcelJS === 'undefined') { toast('Nothing to export', 'warn'); return; }
    var wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Data', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = D.columns.map(function (c) { return { header: c, key: c, width: Math.max(12, Math.min(45, c.length + 4)) }; });
    D.rows.forEach(function (r) { ws.addRow(r); });
    suExcelHeader(ws, D.columns.length);
    wb.xlsx.writeBuffer().then(function (buf) { downloadBlob(new Blob([buf]), 'Setup_' + D.task.code + '_' + nowStamp() + '.xlsx'); });
}
function suExcelHeader(ws, n) {
    ws.getRow(1).eachCell(function (cell) {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC74634' } };
    });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: n } };
}

/** Checklist status report for the whole pod. */
function suExportReport() {
    if (!SU.tasks.length || typeof ExcelJS === 'undefined') { toast('Nothing to export', 'warn'); return; }
    var wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Setup checklist', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
        { header: 'Module', key: 'm', width: 24 }, { header: 'Task', key: 't', width: 40 }, { header: 'FSM task', key: 'f', width: 40 },
        { header: 'Mandatory', key: 'y', width: 11 }, { header: 'Status', key: 's', width: 12 }, { header: 'Rows', key: 'n', width: 10 },
        { header: 'Checked', key: 'c', width: 18 }, { header: 'By', key: 'b', width: 16 }, { header: 'Error', key: 'e', width: 60 }, { header: 'Check SQL', key: 'q', width: 80 }
    ];
    SU.tasks.slice().sort(function (a, b) { return suModuleOrder(a.module) - suModuleOrder(b.module) || a.seq - b.seq; }).forEach(function (t) {
        var row = ws.addRow({ m: suModuleName(t.module), t: t.name, f: t.fsm, y: t.mandatory ? 'Yes' : 'No', s: suLabel(t), n: t.count, c: t.checked, b: t.checkedBy, e: t.error || '', q: t.sql });
        var color = { DONE: 'FFDCFCE7', MISSING: 'FFFEE2E2', ERROR: 'FFFEF3C7' }[t.status];
        if (color) row.getCell('s').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
    });
    suExcelHeader(ws, 10);
    wb.xlsx.writeBuffer().then(function (buf) {
        downloadBlob(new Blob([buf]), 'Fusion_Setup_Checklist_' + currentInstance() + '_' + nowStamp() + '.xlsx');
        toast('Checklist report exported');
    });
}
function suLabel(t) { return !t.status ? 'Not checked' : t.status === 'DONE' ? 'Done' : t.status === 'MISSING' ? 'Not done' : 'Error'; }

// ── Add / edit / delete tasks ─────────────────────────────────
function suEdit(id) {
    var t = id ? suTask(id) : { module: SU.module || 'COMMON', name: '', description: '', fsm: '', sql: '', minRows: 1, mandatory: true, active: true, seq: 100 };
    var mods = (window.FS_SETUP_MODULES || []).map(function (m) { return m[0]; });
    SU.tasks.forEach(function (x) { if (mods.indexOf(x.module) < 0) mods.push(x.module); });
    openModal(id ? 'Edit setup task' : 'Add setup task',
        '<div class="fs-form">' +
        '<div class="fs-form-2"><div><label>Module</label><input id="su-f-module" list="su-mod-list" value="' + esc(t.module) + '"><datalist id="su-mod-list">' +
        mods.map(function (m) { return '<option value="' + esc(m) + '">' + esc(suModuleName(m)) + '</option>'; }).join('') + '</datalist></div>' +
        '<div><label>Order</label><input id="su-f-seq" type="number" value="' + (t.seq || 100) + '"></div></div>' +
        '<label>Task name</label><input id="su-f-name" maxlength="300" value="' + esc(t.name) + '">' +
        '<label>Setup and Maintenance task <small>FSM task to open in Fusion</small></label><input id="su-f-fsm" maxlength="300" value="' + esc(t.fsm) + '">' +
        '<label>Description</label><input id="su-f-desc" maxlength="2000" value="' + esc(t.description) + '">' +
        '<label>Check SQL <small>returns the configured records · done when rows ≥ minimum</small></label>' +
        '<textarea id="su-f-sql" rows="7" spellcheck="false" class="fs-db-sql" style="margin-top:0;">' + esc(t.sql) + '</textarea>' +
        '<div class="fs-form-2"><div><label>Minimum rows</label><input id="su-f-min" type="number" min="0" value="' + t.minRows + '"></div>' +
        '<div><label>Flags</label><div style="display:flex;gap:14px;align-items:center;padding-top:6px;font-size:.84rem;">' +
        '<label style="display:flex;gap:5px;align-items:center;font-weight:400;margin:0;"><input type="checkbox" id="su-f-mand"' + (t.mandatory ? ' checked' : '') + '> Mandatory</label>' +
        '<label style="display:flex;gap:5px;align-items:center;font-weight:400;margin:0;"><input type="checkbox" id="su-f-active"' + (t.active ? ' checked' : '') + '> Active</label></div></div></div>' +
        '</div><div class="fs-muted" id="su-f-test" style="margin-top:10px;min-height:1.2em;"></div>',
        [{ label: '<i class="fa-solid fa-wand-magic-sparkles"></i> Ask AI', cls: 'ghost', onClick: function () { suAskAi(); } },
        { label: '<i class="fa-solid fa-vial"></i> Test', cls: '', onClick: function () { suTestSql(); } },
        { label: 'Cancel', cls: 'ghost', onClick: closeModal },
        { label: '<i class="fa-solid fa-floppy-disk"></i> Save', cls: 'primary', onClick: function () { suSave(id, this); } }], true);
}
function suTestSql() {
    var sql = $('su-f-sql').value.trim(), out = $('su-f-test');
    if (!sql) return;
    out.innerHTML = '<span class="fs-spinner su-spin"></span> Testing on ' + esc(currentInstance()) + '…';
    fsql('SELECT COUNT(*) AS cnt FROM (\n' + suResolveParams(sql) + '\n)', 1).then(function (r) {
        var n = +r.rows[0].CNT, min = parseInt($('su-f-min').value, 10) || 1;
        out.innerHTML = '<span style="color:' + (n >= min ? 'var(--fs-green)' : '#b91c1c') + '"><i class="fa-solid fa-' + (n >= min ? 'check' : 'xmark') + '"></i> ' + n.toLocaleString() + ' row' + (n === 1 ? '' : 's') + ' → ' + (n >= min ? 'Done' : 'Not done') + '</span>';
    }).catch(function (e) { out.innerHTML = '<span style="color:#b91c1c;">' + esc(String(e).split('\n')[0]) + '</span>'; });
}
function suAskAi() {
    var name = $('su-f-name').value.trim() || 'this setup', mod = suModuleName($('su-f-module').value.trim().toUpperCase());
    closeModal();
    showTab('builder'); openAi();
    $('fs-ai-q').value = 'Write a setup check query for the Oracle Fusion ' + mod + ' setup task "' + name + '"' +
        '. It must return one row per configured record (so zero rows means the setup is missing). Verify the tables and columns first.';
    $('fs-ai-q').focus();
}
function suSave(id, btn) {
    var f = {
        module: ($('su-f-module').value || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_'), seq: parseInt($('su-f-seq').value, 10) || 100,
        name: $('su-f-name').value.trim(), fsm: $('su-f-fsm').value.trim(), description: $('su-f-desc').value.trim(),
        sql: $('su-f-sql').value.trim().replace(/;\s*$/, ''), minRows: Math.max(0, parseInt($('su-f-min').value, 10) || 0),
        mandatory: $('su-f-mand').checked, active: $('su-f-active').checked
    };
    if (!f.module || !f.name || !f.sql) { toast('Module, task name and check SQL are required', 'warn'); return; }
    if (!/^\s*(select|with)\b/i.test(f.sql.replace(/^(\s*(--[^\n]*\n|\/\*[\s\S]*?\*\/))*/, ''))) { toast('The check SQL must be a SELECT or WITH statement', 'warn'); return; }
    btn.disabled = true;
    var common = 'module_code = ' + lit(f.module) + ', module_name = ' + vlit(suModuleName(f.module) === f.module ? f.module : suModuleName(f.module), 100) +
        ', seq = ' + f.seq + ', task_name = ' + vlit(f.name, 300) + ', fsm_task = ' + vlit(f.fsm, 300) + ', description = ' + vlit(f.description, 2000) +
        ', check_sql = ' + clobLit(f.sql) + ', min_rows = ' + f.minRows + ', mandatory = ' + lit(f.mandatory ? 'Y' : 'N') + ', active = ' + lit(f.active ? 'Y' : 'N') +
        ', updated_by = ' + vlit(appUserName(), 120) + ', updated_date = SYSDATE';
    var code = 'USR_' + f.module + '_' + Date.now().toString(36).toUpperCase();
    var sql = id
        ? 'UPDATE ' + SU_TASKS + ' SET ' + common + ' WHERE task_id = ' + parseInt(id, 10)
        : 'INSERT INTO ' + SU_TASKS + ' (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, min_rows, mandatory, active, source, created_by, created_date) VALUES (' +
          lit(code) + ', ' + lit(f.module) + ', ' + vlit(suModuleName(f.module), 100) + ', ' + f.seq + ', ' + vlit(f.name, 300) + ', ' + vlit(f.fsm, 300) + ', ' + vlit(f.description, 2000) + ', ' +
          clobLit(f.sql) + ', ' + f.minRows + ', ' + lit(f.mandatory ? 'Y' : 'N') + ', ' + lit(f.active ? 'Y' : 'N') + ", 'USER', " + vlit(appUserName(), 120) + ', SYSDATE)';
    (SU.state === 'missing' ? suCreateTables() : Promise.resolve()).then(function () { return dbWrite(sql); }).then(function () {
        closeModal(); toast(id ? 'Task updated' : 'Task added');
        SU.module = f.module;
        return suLoad();
    }).catch(function (e) { btn.disabled = false; toast('Save failed: ' + e, 'err'); });
}
function suDelete(id) {
    var t = suTask(id); if (!t) return;
    confirmModal('Delete "' + t.name + '"?', 'Removes the task and its check results for everyone.', function () {
        dbWrite('DELETE FROM ' + SU_RESULTS + ' WHERE task_id = ' + parseInt(id, 10))
            .then(function () { return dbWrite('DELETE FROM ' + SU_TASKS + ' WHERE task_id = ' + parseInt(id, 10)); })
            .then(function () { toast('Task deleted'); return suLoad(); })
            .catch(function (e) { toast('Delete failed: ' + e, 'err'); });
    });
}

// ── Render ─────────────────────────────────────────────────────
function suStatus(html) { var el = $('su-status'); if (el) el.innerHTML = '<div>' + html + '</div>'; }
function suStats(list) {
    var s = { total: list.length, done: 0, missing: 0, error: 0, unchecked: 0, mandMissing: 0 };
    list.forEach(function (t) {
        if (!t.active) return;
        if (t.status === 'DONE') s.done++;
        else if (t.status === 'MISSING') { s.missing++; if (t.mandatory) s.mandMissing++; }
        else if (t.status === 'ERROR') s.error++;
        else s.unchecked++;
    });
    s.active = s.done + s.missing + s.error + s.unchecked;
    s.pct = s.active ? Math.round(100 * s.done / s.active) : 0;
    return s;
}
function suRender() {
    if (!$('page-setups')) return;
    var st = SU.state;
    if (st === 'loading') { suStatus('<span class="fs-spinner su-spin"></span> Loading the setup checklist…'); return; }
    if (st === 'offline') { suStatus('<i class="fa-solid fa-plug-circle-xmark" style="color:#b91c1c"></i> APEX database not reachable. <span class="fs-muted">' + esc((SU.error || '').slice(0, 160)) + '</span> <button class="fs-btn sm" onclick="suLoad()"><i class="fa-solid fa-rotate"></i> Retry</button>'); $('su-body').innerHTML = ''; return; }
    if (st === 'missing' || !SU.tasks.length) {
        suStatus('<i class="fa-solid fa-circle-info" style="color:var(--fs-amber)"></i> The setup checklist is empty.');
        $('su-body').innerHTML = '<div class="ds-empty"><div class="ds-empty-icon"><i class="fa-solid fa-list-check"></i></div>' +
            '<h3>Set up the Fusion setup checklist</h3>' +
            '<p class="fs-muted" style="margin-bottom:12px;">Creates <code>WMS_FUSION_SETUP_TASKS</code> and <code>WMS_FUSION_SETUP_RESULTS</code> in the APEX database and loads a starter checklist of ' +
            (window.FS_SETUP_SEED || []).length + ' tasks across ' + (window.FS_SETUP_MODULES || []).length + ' modules (Enterprise Structures, GL, Tax, Cash, AP, AR, FA, Procurement, Inventory, Shipping, OM, Security, HCM). ' +
            'Each task has a check SQL you can edit.</p>' +
            '<div class="ds-empty-actions"><button class="fs-btn primary" id="su-starter-btn" onclick="suLoadStarter()"><i class="fa-solid fa-download"></i> Create tables &amp; load starter checklist</button>' +
            '<button class="fs-btn" onclick="suEdit()"><i class="fa-solid fa-plus"></i> Start empty — add a task</button></div></div>';
        return;
    }
    var all = suStats(SU.tasks);
    suStatus('<b>' + esc(currentInstance()) + '</b> · ' + all.done + ' of ' + all.active + ' setups done (' + all.pct + '%)' +
        (all.mandMissing ? ' · <span style="color:#b91c1c">' + all.mandMissing + ' mandatory not done</span>' : '') +
        (all.error ? ' · <span style="color:#92400e">' + all.error + ' check errors</span>' : '') +
        (all.unchecked ? ' · ' + all.unchecked + ' not checked yet' : '') +
        '<div class="su-bar"><span class="su-bar-done" style="width:' + (all.active ? 100 * all.done / all.active : 0) + '%"></span><span class="su-bar-miss" style="width:' + (all.active ? 100 * all.missing / all.active : 0) + '%"></span><span class="su-bar-err" style="width:' + (all.active ? 100 * all.error / all.active : 0) + '%"></span></div>' +
        '<div id="su-batch"></div>');
    suRenderBatch();

    var mods = [];
    SU.tasks.forEach(function (t) { if (mods.indexOf(t.module) < 0) mods.push(t.module); });
    mods.sort(function (a, b) { return suModuleOrder(a) - suModuleOrder(b) || (a < b ? -1 : 1); });
    if (!SU.module || mods.indexOf(SU.module) < 0) SU.module = mods[0];
    if (!$('su-modules')) {
        $('su-body').innerHTML = '<div class="su-layout"><aside class="su-modules" id="su-modules"></aside><div class="su-main" id="su-main"></div></div>';
    }
    $('su-modules').innerHTML = mods.map(function (m) {
        var s = suStats(SU.tasks.filter(function (t) { return t.module === m; }));
        return '<div class="su-mod' + (m === SU.module ? ' on' : '') + '" onclick="SU.module=\'' + esc(m) + '\';suRender()">' +
            '<div class="su-ring" style="--p:' + s.pct + '"><span>' + s.pct + '%</span></div>' +
            '<div class="su-mod-txt"><b>' + esc(suModuleName(m)) + '</b><small>' + s.done + '/' + s.active + ' done' +
            (s.mandMissing ? ' · <span style="color:#b91c1c">' + s.mandMissing + ' missing</span>' : '') + (s.error ? ' · <span style="color:#92400e">' + s.error + ' err</span>' : '') + '</small></div></div>';
    }).join('');
    suRenderTasks();
}
function suRenderBatch() {
    var el = $('su-batch'); if (!el) return;
    var B = SU.batch;
    el.innerHTML = B ? '<div class="su-batch"><span class="fs-spinner su-spin"></span> Checking ' + B.done + ' / ' + B.total + '…' +
        '<div class="su-batch-bar"><span style="width:' + (100 * B.done / B.total) + '%"></span></div>' +
        '<button class="fs-btn sm danger" onclick="suStop()"><i class="fa-solid fa-stop"></i> Stop</button></div>' : '';
}
function suRenderTasks() {
    var main = $('su-main'); if (!main) return;
    var term = (($('su-search') || {}).value || '').toLowerCase(), filter = ($('su-filter') || {}).value || 'all';
    var list = SU.tasks.filter(function (t) {
        if (term) return (t.name + ' ' + t.description + ' ' + t.fsm + ' ' + t.sql + ' ' + t.module).toLowerCase().indexOf(term) >= 0;
        return t.module === SU.module;
    }).filter(function (t) {
        return filter === 'all' || (filter === 'missing' && t.status === 'MISSING') || (filter === 'error' && t.status === 'ERROR') ||
            (filter === 'unchecked' && !t.status) || (filter === 'done' && t.status === 'DONE');
    });
    var s = suStats(SU.tasks.filter(function (t) { return t.module === SU.module; }));
    main.innerHTML =
        '<div class="su-main-head"><div><h3>' + (term ? 'Search: “' + esc(term) + '”' : esc(suModuleName(SU.module))) + '</h3>' +
        (term ? '' : '<small>' + s.done + ' of ' + s.active + ' done · ' + s.pct + '%</small>') + '</div>' +
        (term ? '' : '<button class="fs-btn sm primary" onclick="suCheckModule()" ' + (SU.batch ? 'disabled' : '') + '><i class="fa-solid fa-play"></i> Check module</button>') + '</div>' +
        (list.map(function (t) {
            var st = SU.running[t.id] ? 'running' : !t.active ? 'inactive' : (t.status || 'unchecked').toLowerCase();
            var icon = { done: 'fa-circle-check', missing: 'fa-circle-xmark', error: 'fa-triangle-exclamation', unchecked: 'fa-circle', running: 'fa-spinner fa-spin', inactive: 'fa-circle-minus' }[st];
            return '<div class="su-task su-' + st + '">' +
                '<i class="fa-solid ' + icon + ' su-icon"></i>' +
                '<div class="su-task-body"><div class="su-task-name">' + esc(t.name) +
                (t.mandatory ? '<span class="su-tag">Mandatory</span>' : '<span class="su-tag opt">Optional</span>') +
                (term ? '<span class="su-tag opt">' + esc(suModuleName(t.module)) + '</span>' : '') + '</div>' +
                '<div class="su-task-desc">' + esc(t.description) + (t.fsm ? ' <span class="su-fsm"><i class="fa-solid fa-gear"></i> ' + esc(t.fsm) + '</span>' : '') + '</div>' +
                (t.checked ? '<div class="su-task-meta">Checked ' + esc(t.checked) + ' by ' + esc(t.checkedBy || '?') + (t.ms != null ? ' · ' + fmtMs(+t.ms) : '') + '</div>' : '') +
                (st === 'error' && t.error ? '<div class="ds-err" style="margin:6px 0 0;">' + esc(t.error) + '</div>' : '') + '</div>' +
                '<div class="su-count">' + (t.count != null && st !== 'error' ? '<b>' + (+t.count).toLocaleString() + '</b><small>row' + (+t.count === 1 ? '' : 's') + '</small>' : '<small>' + suLabel(t) + '</small>') + '</div>' +
                '<div class="su-actions">' +
                '<button class="fs-btn sm" onclick="suCheckOne(' + t.id + ')" title="Run the check" ' + (SU.running[t.id] ? 'disabled' : '') + '><i class="fa-solid fa-play"></i> Check</button>' +
                '<button class="fs-btn sm" onclick="suDrill(' + t.id + ')" title="Show the configured records"><i class="fa-solid fa-magnifying-glass-chart"></i> Data</button>' +
                '<button class="fs-icon-btn" onclick="suEdit(' + t.id + ')" title="Edit task / SQL"><i class="fa-solid fa-pen"></i></button>' +
                '<button class="fs-icon-btn" onclick="suDelete(' + t.id + ')" title="Delete task"><i class="fa-regular fa-trash-can"></i></button>' +
                '</div></div>';
        }).join('') || '<div class="fs-muted" style="padding:20px;">No tasks match.</div>');
}
