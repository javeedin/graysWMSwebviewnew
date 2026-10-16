/* Data Loading — "Setup Projects" tab: track Oracle FSM implementation projects and their tasks.
   Fusion is read-only through the Fusion SQL BIP runner (FSM objects use the ASM_ prefix, e.g.
   ASM_IMPL_PROJECTS_VL). Which objects/columns hold projects and tasks differs by release, so the
   tab discovers the ASM_ objects on the pod, suggests the mapping, and saves it per pod in APEX.
   Every refresh stores the task states, the status changes and a per-project snapshot in APEX
   (apex_sql/71_fsm_tracking.sql), so progress can be followed over time.
   Uses the transport helpers of prepare.js (prRead / prWrite / prFusion / prClob …). */

var FM = { state: 'idle', error: null, cfg: null, projects: [], tasks: [], snaps: [], events: [], sel: null, lastRefresh: null,
    q: '', status: '', assignee: '', overdue: false, group: 'list', settings: false, disc: null, view: lsGet('fm_view', 'projects') };

var FM_DDL = {
    WMS_FSM_CONFIG: 'CREATE TABLE wms_fsm_config (instance VARCHAR2(10) PRIMARY KEY, config_json CLOB, updated_by VARCHAR2(120), updated_date DATE DEFAULT SYSDATE)',
    WMS_FSM_TASKS: 'CREATE TABLE wms_fsm_tasks (instance VARCHAR2(10) NOT NULL, project_key VARCHAR2(100) NOT NULL, task_key VARCHAR2(200) NOT NULL, project_name VARCHAR2(400), ' +
        'task_name VARCHAR2(1000), task_list VARCHAR2(1000), status VARCHAR2(60), status_raw VARCHAR2(100), assignee VARCHAR2(400), due_date VARCHAR2(30), fusion_updated VARCHAR2(30), ' +
        'first_seen DATE, last_seen DATE, completed_seen DATE, CONSTRAINT wms_fsm_tasks_pk PRIMARY KEY (instance, project_key, task_key))',
    WMS_FSM_TASK_EVENTS: 'CREATE TABLE wms_fsm_task_events (event_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, instance VARCHAR2(10), project_key VARCHAR2(100), task_key VARCHAR2(200), ' +
        'task_name VARCHAR2(1000), old_status VARCHAR2(60), new_status VARCHAR2(60), event_date DATE DEFAULT SYSDATE, detected_by VARCHAR2(120))',
    WMS_FSM_SNAPSHOTS: 'CREATE TABLE wms_fsm_snapshots (snap_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, instance VARCHAR2(10), project_key VARCHAR2(100), project_name VARCHAR2(400), ' +
        'total NUMBER, completed NUMBER, in_progress NUMBER, not_started NUMBER, with_errors NUMBER, overdue NUMBER, taken_by VARCHAR2(120), taken_date DATE DEFAULT SYSDATE)'
};
var FM_STATUS = ['Not Started', 'In Progress', 'Completed', 'Completed with errors'];
var FM_STATUS_CLS = { 'Not Started': 'ns', 'In Progress': 'ip', 'Completed': 'ok', 'Completed with errors': 'er' };

var FM_ROLES = {
    projects: [['key', 'Project ID', true], ['name', 'Project name', true], ['code', 'Short name / code'], ['status', 'Status'], ['start', 'Start date'], ['end', 'Target / end date'], ['owner', 'Owner']],
    tasks: [['proj', 'Project ID (link to project)', true], ['key', 'Task ID', true], ['name', 'Task name', true], ['list', 'Task list / functional area'], ['status', 'Status', true],
        ['assignee', 'Assigned to'], ['due', 'Due date'], ['updated', 'Last updated']]
};
var FM_GUESS = {
    projects: { key: [/^IMPL_PROJECT_ID$/, /PROJECT_ID$/, /_ID$/], name: [/^IMPL_PROJECT_NAME$/, /PROJECT_NAME$/, /(^|_)NAME$/], code: [/^SHORT_NAME$/, /CODE$/],
        status: [/STATUS/], start: [/START_DATE/], end: [/(END|FINISH|COMPLETION|DUE|TARGET)_?DATE/], owner: [/OWNER/, /ASSIGN/, /^CREATED_BY$/] },
    tasks: { proj: [/^IMPL_PROJECT_ID$/, /PROJECT_ID$/], key: [/^(IMPL_)?(PROJECT_)?TASK_ID$/, /TASK.*_ID$/, /^[A-Z_]*_ID$/], name: [/TASK_NAME$/, /(^|_)NAME$/, /TASK_CODE$/],
        list: [/TASK_LIST/, /PARENT.*NAME/, /PARENT/, /FUNCTIONAL_AREA/], status: [/STATUS/], assignee: [/ASSIGN/, /USER/, /OWNER/],
        due: [/DUE_DATE/, /(END|FINISH|COMPLETION|TARGET)_?DATE/], updated: [/^LAST_UPDATE_DATE$/, /UPDATE.*DATE/] }
};

// ── helpers ────────────────────────────────────────────────────
function fmInst() { return currentInstance(); }
function fmV(s, max) { s = String(s == null ? '' : s).slice(0, max || 4000); return s ? prLit(s) : 'TO_CHAR(NULL)'; }
function fmToday() { var d = new Date(); return d.getFullYear() + '-' + FE.pad2(d.getMonth() + 1) + '-' + FE.pad2(d.getDate()); }
function fmNormStatus(raw) {
    var s = String(raw == null ? '' : raw).toUpperCase().replace(/[^A-Z]/g, '');
    if (!s || /^(NOTSTARTED|NEW|NOT|OPEN|PENDING|NS)$/.test(s) || s.indexOf('NOTSTART') >= 0) return 'Not Started';
    if (s.indexOf('ERROR') >= 0 || s.indexOf('WARN') >= 0) return 'Completed with errors';
    if (s.indexOf('COMPLET') >= 0 || s === 'DONE' || s === 'CLOSED' || s === 'C') return 'Completed';
    if (s.indexOf('PROGRESS') >= 0 || s === 'IP' || s === 'STARTED' || s === 'ACTIVE') return 'In Progress';
    return 'In Progress';
}
function fmOverdue(t) { return t.due && t.status !== 'Completed' && t.status !== 'Completed with errors' && t.due.slice(0, 10) < fmToday(); }
function fmDateSel(col, type) { return /DATE|TIMESTAMP/.test(type || '') ? "TO_CHAR(" + col + ", 'YYYY-MM-DD')" : col; }

// ── APEX ───────────────────────────────────────────────────────
var _fmEnsured = null;
function fmEnsure() {
    if (_fmEnsured) return _fmEnsured;
    _fmEnsured = prRead("SELECT table_name FROM user_tables WHERE table_name LIKE 'WMS\\_FSM%' ESCAPE '\\'", 20).then(function (r) {
        var have = {}; r.forEach(function (x) { have[x.TABLE_NAME] = 1; });
        var todo = Object.keys(FM_DDL).filter(function (t) { return !have[t]; });
        if (todo.length) toast('Creating the setup tracking tables in APEX…');
        return prSeq(todo, function (t) { return prWrite(FM_DDL[t]); });
    }).catch(function (e) { _fmEnsured = null; throw e; });
    return _fmEnsured;
}
function fmLoadConfig() {
    return prRead("SELECT NVL(LENGTH(config_json), 0) AS len, TO_CHAR(updated_date, 'YYYY-MM-DD HH24:MI') AS upd, updated_by FROM wms_fsm_config WHERE instance = " + prLit(fmInst()), 1).then(function (r) {
        if (!r.length || !+r[0].LEN) return null;
        return prReadClob('wms_fsm_config', 'config_json', 'instance = ' + prLit(fmInst())).then(function (j) { try { return JSON.parse(j); } catch (e) { return null; } });
    });
}
function fmSaveConfig(cfg) {
    var w = 'instance = ' + prLit(fmInst());
    return prRead('SELECT COUNT(*) AS n FROM wms_fsm_config WHERE ' + w, 1).then(function (r) {
        return +r[0].N
            ? prWrite('UPDATE wms_fsm_config SET config_json = ' + prClob(JSON.stringify(cfg)) + ', updated_by = ' + prV(appUserName(), 120) + ', updated_date = SYSDATE WHERE ' + w)
            : prWrite('INSERT INTO wms_fsm_config (instance, config_json, updated_by) VALUES (' + prLit(fmInst()) + ', ' + prClob(JSON.stringify(cfg)) + ', ' + prV(appUserName(), 120) + ')');
    });
}
/** Stored task states (paged through the 1,000-row gateway cap). */
function fmReadStored() {
    var out = [];
    function page(off) {
        return prRead("SELECT project_key, task_key, project_name, task_name, task_list, status, status_raw, assignee, due_date, fusion_updated, " +
            "TO_CHAR(first_seen, 'YYYY-MM-DD HH24:MI') AS first_seen, TO_CHAR(completed_seen, 'YYYY-MM-DD HH24:MI') AS completed_seen, TO_CHAR(last_seen, 'YYYY-MM-DD HH24:MI') AS last_seen " +
            'FROM wms_fsm_tasks WHERE instance = ' + prLit(fmInst()) + ' ORDER BY project_key, task_key OFFSET ' + off + ' ROWS', 1000).then(function (r) {
            out = out.concat(r);
            if (r.length === 1000) return page(off + 1000);
        });
    }
    return page(0).then(function () {
        return out.map(function (x) {
            return { proj: x.PROJECT_KEY, key: x.TASK_KEY, projName: x.PROJECT_NAME, name: x.TASK_NAME || x.TASK_KEY, list: x.TASK_LIST || '', status: x.STATUS || 'Not Started', raw: x.STATUS_RAW,
                assignee: x.ASSIGNEE || '', due: x.DUE_DATE || '', updated: x.FUSION_UPDATED || '', firstSeen: x.FIRST_SEEN, completedSeen: x.COMPLETED_SEEN, lastSeen: x.LAST_SEEN };
        });
    });
}
function fmReadHistory() {
    var w = 'instance = ' + prLit(fmInst());
    return Promise.all([
        prRead("SELECT project_key, project_name, total, completed, in_progress, not_started, with_errors, overdue, TO_CHAR(taken_date, 'YYYY-MM-DD HH24:MI') AS taken FROM wms_fsm_snapshots WHERE " + w + ' ORDER BY snap_id DESC', 1000),
        prRead("SELECT project_key, task_key, task_name, old_status, new_status, detected_by, TO_CHAR(event_date, 'YYYY-MM-DD HH24:MI') AS at FROM wms_fsm_task_events WHERE " + w + ' ORDER BY event_id DESC', 400)
    ]).then(function (r) {
        FM.snaps = r[0].reverse(); FM.events = r[1];
        FM.lastRefresh = FM.snaps.length ? FM.snaps[FM.snaps.length - 1].TAKEN : null;
    });
}

// ── open the tab ───────────────────────────────────────────────
function fmOpenTab() {
    if (FM.state === 'idle' || FM.state === 'offline') fmLoad();
    else fmRender();
}
function fmLoad() {
    if (!hasHost()) { FM.state = 'offline'; FM.error = 'Open this page inside the Gray\'s WMS app — Fusion is read through the app and history is kept in APEX.'; fmRender(); return Promise.resolve(); }
    FM.state = 'loading'; fmRender();
    return fmEnsure().then(fmLoadConfig).then(function (cfg) {
        FM.cfg = cfg;
        if (!cfg) { FM.state = 'ready'; FM.settings = FM.view !== 'exports'; fmRender(); return; }
        return Promise.all([fmReadStored(), fmReadHistory()]).then(function (r) {
            FM.tasks = r[0]; FM.state = 'ready'; fmBuildProjects(); fmRender();
        });
    }).catch(function (e) { FM.state = 'offline'; FM.error = String(e && e.message || e); fmRender(); });
}
/** Projects from the stored tasks + the Fusion project rows of the last refresh (kept in the config). */
function fmBuildProjects() {
    var by = {};
    (FM.cfg && FM.cfg.lastProjects || []).forEach(function (p) { by[p.key] = Object.assign({ tasks: [] }, p); });
    FM.tasks.forEach(function (t) { (by[t.proj] = by[t.proj] || { key: t.proj, name: t.projName || t.proj, tasks: [] }).tasks.push(t); });
    FM.projects = Object.keys(by).map(function (k) {
        var p = by[k], c = { total: p.tasks.length, done: 0, ip: 0, ns: 0, er: 0, od: 0 };
        p.tasks.forEach(function (t) {
            if (t.status === 'Completed') c.done++; else if (t.status === 'Completed with errors') { c.er++; } else if (t.status === 'In Progress') c.ip++; else c.ns++;
            if (fmOverdue(t)) c.od++;
        });
        p.c = c; p.pct = c.total ? Math.round((c.done + c.er) * 100 / c.total) : 0;
        return p;
    }).sort(function (a, b) { return (b.c.total ? 1 : 0) - (a.c.total ? 1 : 0) || String(a.name).localeCompare(String(b.name)); });
    if (!FM.projects.some(function (p) { return p.key === FM.sel; })) FM.sel = lsGet('fm_sel', null);
    if (!FM.projects.some(function (p) { return p.key === FM.sel; })) FM.sel = FM.projects.length ? FM.projects[0].key : null;
}

// ── refresh from Fusion ────────────────────────────────────────
function fmRefresh() {
    var cfg = FM.cfg; if (!cfg) { FM.settings = true; fmRender(); return; }
    var btn = $('fm-refresh'); if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch spin"></i> Reading Fusion…'; }
    var projRows, taskRows, stored, stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    return prFusion(cfg.projects.sql, 5000).then(function (r) { projRows = r.rows || []; return prFusion(cfg.tasks.sql, 50000); })
        .then(function (r) { taskRows = r.rows || []; return fmReadStored(); })
        .then(function (s) {
            stored = {}; s.forEach(function (t) { stored[t.proj + '\u0001' + t.key] = t; });
            var projName = {};
            projRows.forEach(function (p) { projName[String(p.PROJ_KEY)] = p.PROJ_NAME || p.PROJ_CODE || p.PROJ_KEY; });
            var fresh = taskRows.filter(function (t) { return t.PROJ_KEY != null && t.TASK_KEY != null; }).map(function (t) {
                var raw = t.STATUS == null ? '' : String(t.STATUS);
                return { proj: String(t.PROJ_KEY), key: String(t.TASK_KEY), projName: projName[String(t.PROJ_KEY)] || String(t.PROJ_KEY), name: String(t.TASK_NAME || t.TASK_KEY),
                    list: t.TASK_LIST == null ? '' : String(t.TASK_LIST), status: fmNormStatus(raw), raw: raw, assignee: t.ASSIGNEE == null ? '' : String(t.ASSIGNEE),
                    due: t.DUE_DATE == null ? '' : String(t.DUE_DATE).slice(0, 10), updated: t.UPDATED == null ? '' : String(t.UPDATED).slice(0, 19) };
            });
            var news = [], changed = [], events = [];
            fresh.forEach(function (t) {
                var o = stored[t.proj + '\u0001' + t.key];
                if (!o) { news.push(t); return; }
                if (o.status !== t.status) events.push({ t: t, from: o.status });
                if (o.status !== t.status || o.name !== t.name || o.list !== t.list || o.assignee !== t.assignee || o.due !== t.due || o.raw !== t.raw || o.projName !== t.projName) changed.push({ t: t, o: o });
            });
            var user = appUserName(), I = prLit(fmInst()), done = 0, total = news.length + changed.length;
            if (btn) btn.innerHTML = '<i class="fa-solid fa-circle-notch spin"></i> Saving to APEX…';
            var sels = news.map(function (t) {
                return 'SELECT ' + I + ', ' + fmV(t.proj, 100) + ', ' + fmV(t.key, 200) + ', ' + fmV(t.projName, 400) + ', ' + fmV(t.name, 1000) + ', ' + fmV(t.list, 1000) + ', ' + fmV(t.status, 60) + ', ' +
                    fmV(t.raw, 100) + ', ' + fmV(t.assignee, 400) + ', ' + fmV(t.due, 30) + ', ' + fmV(t.updated, 30) + ', SYSDATE, SYSDATE, ' + (/^Completed/.test(t.status) ? 'SYSDATE' : 'CAST(NULL AS DATE)') + ' FROM dual';
            });
            return prSeq(prBatches(sels), function (b) {
                return prWrite('INSERT INTO wms_fsm_tasks (instance, project_key, task_key, project_name, task_name, task_list, status, status_raw, assignee, due_date, fusion_updated, first_seen, last_seen, completed_seen) ' + b.join(' UNION ALL '))
                    .then(function () { done += b.length; if (btn) btn.innerHTML = '<i class="fa-solid fa-circle-notch spin"></i> Saving ' + done + ' / ' + total + '…'; });
            }).then(function () {
                return prSeq(changed, function (x) {
                    var t = x.t;
                    return prWrite('UPDATE wms_fsm_tasks SET project_name = ' + fmV(t.projName, 400) + ', task_name = ' + fmV(t.name, 1000) + ', task_list = ' + fmV(t.list, 1000) + ', status = ' + fmV(t.status, 60) +
                        ', status_raw = ' + fmV(t.raw, 100) + ', assignee = ' + fmV(t.assignee, 400) + ', due_date = ' + fmV(t.due, 30) + ', fusion_updated = ' + fmV(t.updated, 30) + ', last_seen = SYSDATE' +
                        (/^Completed/.test(t.status) && !x.o.completedSeen ? ', completed_seen = SYSDATE' : '') +
                        ' WHERE instance = ' + I + ' AND project_key = ' + fmV(t.proj, 100) + ' AND task_key = ' + fmV(t.key, 200))
                        .then(function () { done++; if (btn) btn.innerHTML = '<i class="fa-solid fa-circle-notch spin"></i> Saving ' + done + ' / ' + total + '…'; });
                });
            }).then(function () {
                if (!events.length) return;
                return prSeq(prBatches(events.map(function (e) {
                    return 'SELECT ' + I + ', ' + fmV(e.t.proj, 100) + ', ' + fmV(e.t.key, 200) + ', ' + fmV(e.t.name, 1000) + ', ' + fmV(e.from, 60) + ', ' + fmV(e.t.status, 60) + ', ' + fmV(user, 120) + ' FROM dual';
                })), function (b) { return prWrite('INSERT INTO wms_fsm_task_events (instance, project_key, task_key, task_name, old_status, new_status, detected_by) ' + b.join(' UNION ALL ')); });
            }).then(function () {
                // one snapshot per project for the burn-down
                FM.tasks = fresh;
                FM.cfg.lastProjects = projRows.map(function (p) {
                    return { key: String(p.PROJ_KEY), name: String(p.PROJ_NAME || p.PROJ_CODE || p.PROJ_KEY), code: p.PROJ_CODE || '', fstatus: p.PROJ_STATUS || '', start: p.START_DATE ? String(p.START_DATE).slice(0, 10) : '', end: p.END_DATE ? String(p.END_DATE).slice(0, 10) : '', owner: p.OWNER || '' };
                });
                FM.cfg.lastRefresh = stamp;
                fmBuildProjects();
                var snaps = FM.projects.filter(function (p) { return p.c.total; }).map(function (p) {
                    return 'SELECT ' + I + ', ' + fmV(p.key, 100) + ', ' + fmV(p.name, 400) + ', ' + p.c.total + ', ' + p.c.done + ', ' + p.c.ip + ', ' + p.c.ns + ', ' + p.c.er + ', ' + p.c.od + ', ' + fmV(user, 120) + ' FROM dual';
                });
                return prSeq(prBatches(snaps), function (b) {
                    return prWrite('INSERT INTO wms_fsm_snapshots (instance, project_key, project_name, total, completed, in_progress, not_started, with_errors, overdue, taken_by) ' + b.join(' UNION ALL '));
                }).then(function () { return fmSaveConfig(FM.cfg); }).then(fmReadHistory).then(function () {
                    toast(fresh.length + ' tasks in ' + projRows.length + ' projects · ' + news.length + ' new · ' + events.length + ' status changes');
                });
            });
        })
        .then(function () { fmResetBtn(); fmRender(); })
        .catch(function (e) { fmResetBtn(); toast('Refresh failed: ' + e); fmRender(); });
}
function fmResetBtn() { var b = $('fm-refresh'); if (b) { b.disabled = false; b.innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i> Read from Fusion'; } }

// ── rendering ──────────────────────────────────────────────────
function fmRender() {
    var side = $('fm-list'), main = $('fm-main'); if (!side || !main) return;
    var info = $('fm-last');
    if (info) info.textContent = FM.lastRefresh ? 'Last read from Fusion ' + prAgo(FM.lastRefresh) + ' · ' + fmInst() : fmInst();
    if (FM.state === 'loading') { side.innerHTML = '<div class="empty"><i class="fa-solid fa-circle-notch spin"></i> Loading…</div>'; main.innerHTML = ''; return; }
    if (FM.state === 'offline') { side.innerHTML = ''; main.innerHTML = '<div class="welcome"><h2>Setup Projects</h2><p>' + esc(FM.error || '') + '</p><button class="btn primary" data-fm="reload"><i class="fa-solid fa-rotate"></i> Try again</button></div>'; return; }
    fmViewChrome();
    if (FM.view === 'exports') {
        if (!FX.loaded) {
            FX.loaded = 'loading';
            side.innerHTML = '<div class="empty"><i class="fa-solid fa-circle-notch spin"></i> Loading…</div>'; main.innerHTML = '';
            fxLoad().then(function () { FX.loaded = true; fxRenderIfShown(); }).catch(function (e) { FX.loaded = false; main.innerHTML = '<div class="welcome"><h2>Setup data</h2><p>' + esc(String(e)) + '</p></div>'; });
            return;
        }
        if (FX.loaded === true) fxRender();
        return;
    }
    fmRenderList();
    if (FM.settings || !FM.cfg) { fmRenderSettings(); return; }
    fmRenderProject();
}
/** Projects | Setup data switch in the side pane. */
function fmViewChrome() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-fmview]'), function (b) { b.classList.toggle('on', b.getAttribute('data-fmview') === FM.view); });
    var ex = FM.view === 'exports';
    $('fm-refbar').hidden = ex; $('fm-settings').hidden = ex; $('fx-newbar').hidden = !ex;
}
function fmRenderList() {
    var el = $('fm-list');
    if (!FM.cfg) { el.innerHTML = '<div class="empty">Not set up yet for ' + esc(fmInst()) + '.<br><small>Find the FSM tables on the right.</small></div>'; return; }
    if (!FM.projects.length) { el.innerHTML = '<div class="empty">No projects yet.<br><small>Click <b>Read from Fusion</b>.</small></div>'; return; }
    el.innerHTML = FM.projects.map(function (p) {
        var c = p.c, seg = function (n, cls) { return c.total && n ? '<i class="' + cls + '" style="width:' + (n * 100 / c.total) + '%"></i>' : ''; };
        return '<div class="it fm-it' + (p.key === FM.sel && !FM.settings ? ' sel' : '') + '" data-fmproj="' + esc(p.key) + '"><div class="fm-ring" style="--p:' + p.pct + '"><span>' + p.pct + '%</span></div>' +
            '<div class="tx"><div class="nm">' + esc(p.name) + '</div><div class="fl">' + (c.total ? c.total + ' tasks' : 'no tasks') + (p.code ? ' · ' + esc(p.code) : '') + '</div>' +
            '<div class="fm-bar">' + seg(c.done, 'ok') + seg(c.er, 'er') + seg(c.ip, 'ip') + seg(c.ns, 'ns') + '</div>' +
            (c.od ? '<div class="fm-od"><i class="fa-solid fa-clock"></i> ' + c.od + ' overdue</div>' : '') + '</div></div>';
    }).join('');
}
function fmProj() { return FM.projects.filter(function (p) { return p.key === FM.sel; })[0]; }
function fmRenderProject() {
    var main = $('fm-main'), p = fmProj();
    if (!p) { main.innerHTML = '<div class="welcome"><h2>Setup Projects</h2><p>Click <b>Read from Fusion</b> to load your implementation projects and their tasks.</p></div>'; return; }
    var c = p.c, snaps = FM.snaps.filter(function (s) { return s.PROJECT_KEY === p.key; }), evs = FM.events.filter(function (e) { return e.PROJECT_KEY === p.key; });
    var prev = snaps.length > 1 ? snaps[snaps.length - 2] : null, delta = prev ? c.done + c.er - (+prev.COMPLETED + +(prev.WITH_ERRORS || 0)) : null;
    var h = '<div class="fm-head"><div class="fm-ring big" style="--p:' + p.pct + '"><span>' + p.pct + '%</span></div><div class="grow"><h2>' + esc(p.name) + '</h2>' +
        '<div class="muted">' + [p.code, p.fstatus && 'status ' + p.fstatus, p.owner && 'owner ' + p.owner, p.start && 'start ' + p.start, p.end && 'target ' + p.end].filter(Boolean).map(esc).join(' · ') + '</div></div>' +
        '<button class="btn" data-fm="csv"><i class="fa-solid fa-file-csv"></i> Export</button></div>';
    h += '<div class="kpis fm-kpis">' +
        '<div class="kpi"><b>' + c.total + '</b><span>tasks</span></div>' +
        '<div class="kpi ok"><b>' + c.done + '</b><span>completed' + (c.er ? ' (+' + c.er + ' with errors)' : '') + '</span></div>' +
        '<div class="kpi"><b>' + c.ip + '</b><span>in progress</span></div>' +
        '<div class="kpi"><b>' + c.ns + '</b><span>not started</span></div>' +
        '<div class="kpi ' + (c.od ? 'err' : '') + '"><b>' + c.od + '</b><span>overdue</span></div>' +
        '<div class="kpi"><b>' + (delta == null ? '—' : (delta >= 0 ? '+' : '') + delta) + '</b><span>completed since last read</span></div></div>';
    h += '<div class="fm-row"><div class="fm-card"><h3><i class="fa-solid fa-chart-line"></i> Progress over time</h3>' + fmBurn(snaps) + '</div>' +
        '<div class="fm-card"><h3><i class="fa-solid fa-bolt"></i> Recent changes</h3>' + (evs.length ? '<div class="fm-evs">' + evs.slice(0, 12).map(function (e) {
            return '<div><span class="muted">' + esc(e.AT) + '</span> <b>' + esc(e.TASK_NAME || e.TASK_KEY) + '</b> ' + fmChip(e.OLD_STATUS) + ' <i class="fa-solid fa-arrow-right"></i> ' + fmChip(e.NEW_STATUS) + '</div>';
        }).join('') + '</div>' : '<p class="muted">No status changes seen yet — they appear from the second read on.</p>') + '</div></div>';
    // filters + tasks
    var assignees = {}; p.tasks.forEach(function (t) { if (t.assignee) assignees[t.assignee] = 1; });
    h += '<div class="fm-filters"><input type="search" id="fm-q" placeholder="Find task…" value="' + esc(FM.q) + '">' +
        '<div class="seg sm">' + [['', 'All']].concat(FM_STATUS.map(function (s) { return [s, s]; })).map(function (s) {
            var n = s[0] ? p.tasks.filter(function (t) { return t.status === s[0]; }).length : p.tasks.length;
            return '<button class="' + (FM.status === s[0] ? 'on' : '') + '" data-fmstatus="' + esc(s[0]) + '">' + esc(s[1]) + ' <small>' + n + '</small></button>';
        }).join('') + '</div>' +
        '<select id="fm-assignee"><option value="">Anyone</option>' + Object.keys(assignees).sort().map(function (a) { return '<option' + (FM.assignee === a ? ' selected' : '') + '>' + esc(a) + '</option>'; }).join('') + '</select>' +
        '<label class="sw"><input type="checkbox" id="fm-overdue"' + (FM.overdue ? ' checked' : '') + '> Overdue only</label>' +
        '<select id="fm-group"><option value="list"' + (FM.group === 'list' ? ' selected' : '') + '>Group by task list</option><option value="status"' + (FM.group === 'status' ? ' selected' : '') + '>Group by status</option><option value="assignee"' + (FM.group === 'assignee' ? ' selected' : '') + '>Group by assignee</option></select></div>';
    h += '<div id="fm-tasks"></div>';
    main.innerHTML = h;
    fmRenderTasks();
}
function fmChip(s) { s = s || 'Not Started'; return '<span class="fm-chip ' + (FM_STATUS_CLS[s] || 'ns') + '">' + esc(s) + '</span>'; }
function fmFiltered(p) {
    var q = FM.q.toLowerCase();
    return p.tasks.filter(function (t) {
        return (!FM.status || t.status === FM.status) && (!FM.assignee || t.assignee === FM.assignee) && (!FM.overdue || fmOverdue(t)) &&
            (!q || (t.name + ' ' + t.list + ' ' + t.assignee + ' ' + t.key).toLowerCase().indexOf(q) >= 0);
    });
}
function fmRenderTasks() {
    var el = $('fm-tasks'), p = fmProj(); if (!el || !p) return;
    var list = fmFiltered(p), groups = {}, order = [];
    list.forEach(function (t) {
        var g = FM.group === 'status' ? t.status : FM.group === 'assignee' ? (t.assignee || 'Unassigned') : (t.list || 'Tasks');
        if (!groups[g]) { groups[g] = []; order.push(g); }
        groups[g].push(t);
    });
    if (FM.group === 'status') order.sort(function (a, b) { return FM_STATUS.indexOf(a) - FM_STATUS.indexOf(b); });
    if (!list.length) { el.innerHTML = '<div class="empty">No task matches.</div>'; return; }
    el.innerHTML = order.map(function (g) {
        var ts = groups[g], done = ts.filter(function (t) { return /^Completed/.test(t.status); }).length;
        return '<details class="fm-grp" open><summary><b>' + esc(g) + '</b><span class="muted">' + done + ' / ' + ts.length + ' done</span><span class="fm-bar sm"><i class="ok" style="width:' + (done * 100 / ts.length) + '%"></i></span></summary>' +
            '<table class="grid fm-t"><thead><tr><th>Task</th><th>Status</th><th>Assigned to</th><th>Due</th><th>Updated in Fusion</th><th>Completed seen</th></tr></thead><tbody>' +
            ts.map(function (t) {
                var od = fmOverdue(t);
                return '<tr' + (od ? ' class="od"' : '') + '><td title="' + esc(t.key) + '">' + esc(t.name) + '</td><td>' + fmChip(t.status) + (t.raw && t.raw !== t.status ? ' <small class="muted">' + esc(t.raw) + '</small>' : '') + '</td>' +
                    '<td>' + esc(t.assignee) + '</td><td>' + esc(t.due) + (od ? ' <em class="fm-late">overdue</em>' : '') + '</td><td>' + esc(t.updated) + '</td><td>' + esc(t.completedSeen || '') + '</td></tr>';
            }).join('') + '</tbody></table></details>';
    }).join('');
}
/** Tiny SVG line of % complete per read. */
function fmBurn(snaps) {
    if (snaps.length < 2) return '<p class="muted">The line appears after the second read from Fusion' + (snaps.length && snaps[0].TAKEN ? ' (first read ' + esc(snaps[0].TAKEN) + ')' : '') + '.</p>';
    var W = 520, H = 150, P = 28, pts = snaps.map(function (s, i) {
        var pct = +s.TOTAL ? (+s.COMPLETED + +(s.WITH_ERRORS || 0)) * 100 / +s.TOTAL : 0;
        return { x: P + i * (W - 2 * P) / (snaps.length - 1), y: H - P - pct * (H - 2 * P) / 100, pct: Math.round(pct), t: String(s.TAKEN || '') };
    });
    var path = pts.map(function (p, i) { return (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1); }).join(' ');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="fm-svg" role="img" aria-label="Percent complete per read">' +
        [0, 50, 100].map(function (v) { var y = H - P - v * (H - 2 * P) / 100; return '<line x1="' + P + '" x2="' + (W - P) + '" y1="' + y + '" y2="' + y + '" class="gl"/><text x="4" y="' + (y + 4) + '">' + v + '%</text>'; }).join('') +
        '<path d="' + path + ' L' + pts[pts.length - 1].x + ' ' + (H - P) + ' L' + pts[0].x + ' ' + (H - P) + ' Z" class="area"/><path d="' + path + '" class="ln"/>' +
        pts.map(function (p) { return '<circle cx="' + p.x + '" cy="' + p.y + '" r="3.5"><title>' + esc(p.t) + ': ' + p.pct + '%</title></circle>'; }).join('') +
        '<text x="' + P + '" y="' + (H - 6) + '">' + esc(pts[0].t.slice(0, 10)) + '</text><text x="' + (W - P) + '" y="' + (H - 6) + '" text-anchor="end">' + esc(pts[pts.length - 1].t.slice(0, 10)) + '</text></svg>';
}
function fmExportCsv() {
    var p = fmProj(); if (!p) return;
    var rows = [['Project', 'Task list', 'Task', 'Status', 'Fusion status', 'Assigned to', 'Due', 'Overdue', 'Updated in Fusion', 'Completed seen', 'Task ID']];
    fmFiltered(p).forEach(function (t) { rows.push([p.name, t.list, t.name, t.status, t.raw, t.assignee, t.due, fmOverdue(t) ? 'Y' : '', t.updated, t.completedSeen || '', t.key]); });
    var csv = '﻿' + rows.map(function (r) { return r.map(function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','); }).join('\r\n');
    prDownload(new Blob([csv], { type: 'text/csv' }), 'FSM_' + p.name.replace(/[^\w]+/g, '_') + '_' + prStamp() + '.csv');
}

// ── settings: discover the FSM objects and map their columns ──
function fmRenderSettings() {
    var main = $('fm-main'), D = FM.disc || (FM.disc = fmDiscFromCfg());
    var h = '<div class="fm-set"><div class="fm-set-h"><h2><i class="fa-solid fa-magnifying-glass-chart"></i> Where FSM keeps projects and tasks</h2>' +
        (FM.cfg ? '<button class="btn" data-fm="closeset"><i class="fa-solid fa-xmark"></i> Close</button>' : '') + '</div>' +
        '<p class="muted">FSM stores implementation projects and their tasks in <code>ASM_</code> objects (e.g. <code>ASM_IMPL_PROJECTS_VL</code>). Their names differ between releases, so read them from your pod (<b>' + esc(fmInst()) + '</b>), check the suggestion, and save. Everything runs read-only through the Fusion SQL runner.</p>' +
        '<div class="row-f"><button class="btn primary" data-fm="discover"><i class="fa-solid fa-magnifying-glass"></i> Find FSM tables in Fusion</button>' +
        (D.objects ? '<span class="muted">' + D.objects.length + ' ASM_ objects found</span>' : '') + '</div>';
    ['projects', 'tasks'].forEach(function (role) {
        var R = D[role];
        h += '<div class="fm-role"><h3>' + (role === 'projects' ? '1 · Implementation projects' : '2 · Project tasks') + '</h3>' +
            '<div class="row-f"><label class="fld grow"><span>Fusion table / view</span><input list="fm-objlist" data-fmobj="' + role + '" value="' + esc(R.obj || '') + '" placeholder="e.g. ' + (role === 'projects' ? 'ASM_IMPL_PROJECTS_VL' : 'an ASM_…TASK… view') + '"></label>' +
            '<button class="btn" data-fm="cols" data-role="' + role + '"><i class="fa-solid fa-table-columns"></i> Read columns</button>' +
            '<label class="sw"><input type="checkbox" data-fmcustom="' + role + '"' + (R.custom ? ' checked' : '') + '> Write my own SQL</label></div>';
        if (R.custom) {
            h += '<textarea class="code" rows="6" data-fmsql="' + role + '" spellcheck="false">' + esc(R.sql || fmGenSql(role, R)) + '</textarea><p class="muted">Must return the columns ' +
                (role === 'projects' ? 'PROJ_KEY, PROJ_NAME (and optionally PROJ_CODE, PROJ_STATUS, START_DATE, END_DATE, OWNER)' : 'PROJ_KEY, TASK_KEY, TASK_NAME, STATUS (and optionally TASK_LIST, ASSIGNEE, DUE_DATE, UPDATED)') + '. Join other ASM_ views here if the names live elsewhere.</p>';
        } else if (R.columns) {
            h += '<div class="fm-map">' + FM_ROLES[role].map(function (x) {
                return '<label class="fld"><span>' + esc(x[1]) + (x[2] ? ' <em class="req">*</em>' : '') + '</span><select data-fmcol="' + role + '|' + x[0] + '"><option value="">—</option>' +
                    R.columns.map(function (c) { return '<option' + (R.cols[x[0]] === c.name ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select></label>';
            }).join('') + '</div><pre class="code fm-sqlprev">' + esc(fmGenSql(role, R)) + '</pre>';
        }
        h += '<div class="row-f"><button class="btn" data-fm="preview" data-role="' + role + '"><i class="fa-solid fa-play"></i> Preview</button><span class="muted" id="fm-pv-note-' + role + '"></span></div><div id="fm-pv-' + role + '"></div></div>';
    });
    h += '<div class="row-f"><button class="btn primary big" data-fm="saveset"><i class="fa-solid fa-floppy-disk"></i> Save and read from Fusion</button><span class="muted">Saved in APEX for ' + esc(fmInst()) + ' — everyone on this pod uses it.</span></div>';
    h += '<datalist id="fm-objlist">' + (D.objects || []).map(function (o) { return '<option value="' + esc(o.name) + '">' + esc(o.type) + '</option>'; }).join('') + '</datalist></div>';
    if (D.objects) {
        h += '<details class="fm-objs"><summary>All ASM_ objects on ' + esc(fmInst()) + ' (' + D.objects.length + ')</summary><div class="chips">' +
            D.objects.map(function (o) { return '<span class="chip-src" title="' + esc(o.type) + '">' + esc(o.name) + '</span>'; }).join('') + '</div></details>';
    }
    main.innerHTML = h;
}
function fmDiscFromCfg() {
    var c = FM.cfg || {};
    return { objects: null, projects: Object.assign({ obj: '', cols: {}, columns: null, custom: false, sql: '' }, c.projects || {}), tasks: Object.assign({ obj: '', cols: {}, columns: null, custom: false, sql: '' }, c.tasks || {}) };
}
function fmGenSql(role, R) {
    var c = R.cols || {}, type = {};
    (R.columns || []).forEach(function (x) { type[x.name] = x.type; });
    var col = function (k, alias, asText) { var n = c[k]; if (!n) return 'NULL AS ' + alias; var e = fmDateSel(n, type[n]); return (asText && e === n ? 'TO_CHAR(' + n + ')' : e) + ' AS ' + alias; };
    var obj = R.obj || '<table>';
    if (role === 'projects') return 'SELECT ' + [col('key', 'proj_key', true), col('name', 'proj_name'), col('code', 'proj_code'), col('status', 'proj_status'), col('start', 'start_date'), col('end', 'end_date'), col('owner', 'owner')].join(',\n       ') + '\nFROM ' + obj;
    return 'SELECT ' + [col('proj', 'proj_key', true), col('key', 'task_key', true), col('name', 'task_name'), col('list', 'task_list'), col('status', 'status'), col('assignee', 'assignee'), col('due', 'due_date'), col('updated', 'updated')].join(',\n       ') + '\nFROM ' + obj;
}
function fmScoreObj(role, n) {
    if (role === 'projects') return n === 'ASM_IMPL_PROJECTS_VL' ? 100 : /IMPL_PROJECTS?_VL?$/.test(n) ? 90 : /IMPL_PROJECT/.test(n) && !/TASK/.test(n) ? 60 : /PROJECT/.test(n) && !/TASK/.test(n) ? 30 : 0;
    var s = /IMPL.*TASK|PROJ.*TASK/.test(n) ? 60 : /TASK/.test(n) ? 25 : 0;
    if (s && /_VL?$/.test(n)) s += 15;
    if (s && /ASSIGN|STATUS/.test(n)) s += 8;
    if (s && /_TL$|HIST|AUDIT|_ARCH|TMP|_GT$/.test(n)) s -= 30;
    return s;
}
function fmDiscover() {
    var D = FM.disc;
    toast('Reading the ASM_ objects from Fusion…');
    return prFusion("SELECT DISTINCT object_name, object_type FROM all_objects WHERE object_name LIKE 'ASM\\_%' ESCAPE '\\' AND object_type IN ('TABLE', 'VIEW') ORDER BY object_name", 5000).then(function (r) {
        D.objects = (r.rows || []).map(function (x) { return { name: x.OBJECT_NAME, type: x.OBJECT_TYPE }; });
        if (!D.objects.length) { toast('No ASM_ objects are visible to the runner on this pod.'); fmRenderSettings(); return; }
        var best = function (role) { return D.objects.map(function (o) { return { o: o, s: fmScoreObj(role, o.name) }; }).filter(function (x) { return x.s > 0; }).sort(function (a, b) { return b.s - a.s; })[0]; };
        var jobs = [];
        ['projects', 'tasks'].forEach(function (role) {
            if (D[role].obj) return;
            var b = best(role); if (b) { D[role].obj = b.o.name; jobs.push(role); }
        });
        return prSeq(jobs, fmReadCols).then(function () { fmRenderSettings(); toast(D.objects.length + ' ASM_ objects — check the suggestion and Preview.'); });
    }).catch(function (e) { toast('Could not read the Fusion dictionary: ' + e); });
}
function fmReadCols(role) {
    var R = FM.disc[role], obj = String(R.obj || '').trim().toUpperCase();
    if (!/^[A-Z0-9_$#]+$/.test(obj)) { toast('Enter a table or view name.'); return Promise.resolve(); }
    R.obj = obj;
    return prFusion("SELECT column_name, data_type, MIN(column_id) AS pos FROM all_tab_columns WHERE table_name = '" + obj + "' GROUP BY column_name, data_type ORDER BY pos", 2000).then(function (r) {
        R.columns = (r.rows || []).map(function (x) { return { name: x.COLUMN_NAME, type: x.DATA_TYPE }; });
        if (!R.columns.length) { toast(obj + ' has no columns visible to the runner.'); return; }
        var names = R.columns.map(function (c) { return c.name; }), used = {};
        R.cols = {};
        FM_ROLES[role].forEach(function (x) {
            var pats = FM_GUESS[role][x[0]] || [];
            for (var i = 0; i < pats.length; i++) {
                var hit = names.filter(function (n) { return pats[i].test(n) && !used[n]; })[0];
                if (hit) { R.cols[x[0]] = hit; used[hit] = 1; break; }
            }
        });
        if (role === 'tasks' && FM.disc.projects.cols.key && names.indexOf(FM.disc.projects.cols.key) >= 0) { if (R.cols.proj) delete used[R.cols.proj]; R.cols.proj = FM.disc.projects.cols.key; }
        R.sql = '';
    });
}
function fmPreview(role) {
    var R = FM.disc[role], sql = R.custom ? (R.sql || fmGenSql(role, R)) : fmGenSql(role, R), box = $('fm-pv-' + role), note = $('fm-pv-note-' + role);
    if (note) note.textContent = 'Running…';
    return prFusion(sql, 20).then(function (r) {
        var cols = r.columns && r.columns.length ? r.columns : r.rows && r.rows[0] ? Object.keys(r.rows[0]) : [];
        if (note) note.textContent = (r.rows || []).length + ' rows shown (first 20)';
        if (role === 'tasks' && r.rows && r.rows.length) {
            var raws = {}; r.rows.forEach(function (x) { raws[x.STATUS] = fmNormStatus(x.STATUS); });
            if (note) note.textContent += ' · statuses: ' + Object.keys(raws).map(function (k) { return (k === 'null' || k === 'undefined' ? '(blank)' : k) + ' → ' + raws[k]; }).join(', ');
        }
        box.innerHTML = '<div class="grid-w"><table class="grid"><thead><tr>' + cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
            (r.rows || []).map(function (x) { return '<tr>' + cols.map(function (c) { return '<td>' + esc(x[String(c).toUpperCase()] == null ? '' : x[String(c).toUpperCase()]) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
    }).catch(function (e) { if (note) note.textContent = ''; box.innerHTML = '<div class="note err"><i class="fa-solid fa-circle-xmark"></i> ' + esc(String(e)) + '</div>'; });
}
function fmSaveSettings() {
    var D = FM.disc, cfg = FM.cfg || {};
    var need = { projects: ['key', 'name'], tasks: ['proj', 'key', 'name', 'status'] };
    for (var role in need) {
        var R = D[role];
        if (!R.custom && need[role].some(function (k) { return !R.cols[k]; })) { toast('Map the required columns (*) of ' + (role === 'projects' ? 'projects' : 'tasks') + ' first.'); return; }
        if (!R.obj && !R.custom) { toast('Pick the Fusion table for ' + role + '.'); return; }
    }
    ['projects', 'tasks'].forEach(function (role) {
        var R = D[role];
        cfg[role] = { obj: R.obj, cols: R.cols, custom: !!R.custom, sql: R.custom ? (R.sql || fmGenSql(role, R)) : fmGenSql(role, R), columns: R.columns };
    });
    FM.cfg = cfg;
    toast('Saving the setup to APEX…');
    fmSaveConfig(cfg).then(function () { FM.settings = false; fmRender(); return fmRefresh(); }).catch(function (e) { toast('Could not save: ' + e); });
}

// ── events ─────────────────────────────────────────────────────
(function fmWire() {
    if (!$('page-fsm')) return;
    $('fm-refresh').addEventListener('click', function () { fmRefresh(); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-fmview]'), function (b) {
        b.addEventListener('click', function () { FM.view = b.getAttribute('data-fmview'); lsSet('fm_view', FM.view); fmRender(); });
    });
    $('fx-new').addEventListener('click', function () { FX.form = true; if (FX.loaded === true) fxRender(); });
    $('fm-settings').addEventListener('click', function () { FM.settings = true; FM.disc = null; fmRender(); });
    $('fm-list').addEventListener('click', function (e) {
        if (FM.view === 'exports') return;
        var it = e.target.closest('[data-fmproj]'); if (!it) return;
        FM.sel = it.getAttribute('data-fmproj'); lsSet('fm_sel', FM.sel); FM.settings = false; fmRender();
    });
    var main = $('fm-main');
    main.addEventListener('click', function (e) {
        if (FM.view === 'exports') return;
        var b = e.target.closest('[data-fm]'), s;
        if ((s = e.target.closest('[data-fmstatus]'))) { FM.status = s.getAttribute('data-fmstatus'); fmRenderProject(); return; }
        if (!b) return;
        var a = b.getAttribute('data-fm'), role = b.getAttribute('data-role');
        if (a === 'reload') fmLoad();
        else if (a === 'csv') fmExportCsv();
        else if (a === 'closeset') { FM.settings = false; fmRender(); }
        else if (a === 'discover') fmDiscover();
        else if (a === 'cols') fmReadCols(role).then(fmRenderSettings);
        else if (a === 'preview') fmPreview(role);
        else if (a === 'saveset') fmSaveSettings();
    });
    main.addEventListener('change', function (e) {
        var t = e.target, v;
        if ((v = t.getAttribute('data-fmcol'))) { var k = v.split('|'); FM.disc[k[0]].cols[k[1]] = t.value; FM.disc[k[0]].sql = ''; fmRenderSettings(); }
        else if ((v = t.getAttribute('data-fmcustom'))) { var R = FM.disc[v]; if (t.checked && !R.sql) R.sql = fmGenSql(v, R); R.custom = t.checked; fmRenderSettings(); }
        else if ((v = t.getAttribute('data-fmobj'))) { FM.disc[v].obj = t.value.trim(); if (FM.disc[v].obj) fmReadCols(v).then(fmRenderSettings); }
        else if (t.id === 'fm-assignee') { FM.assignee = t.value; fmRenderTasks(); }
        else if (t.id === 'fm-overdue') { FM.overdue = t.checked; fmRenderTasks(); }
        else if (t.id === 'fm-group') { FM.group = t.value; fmRenderTasks(); }
    });
    main.addEventListener('input', function (e) {
        var t = e.target, v;
        if (t.id === 'fm-q') { FM.q = t.value.trim(); fmRenderTasks(); }
        else if ((v = t.getAttribute('data-fmsql'))) FM.disc[v].sql = t.value;
    });
})();
