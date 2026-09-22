// ============================================================
// DAILY TASKS — assign work to the AI Digital Employee & trace it
// ============================================================
// A day-by-day task board. You assign tasks (one-off or daily), the AI can
// work them, and EVERY action is written to wms_ai_task_events so you have
// full visibility + traceability. Tasks are stored in wms_ai_tasks. All
// reads/writes go through the existing guarded gateways (ai/executequery +
// ai/executewrite) — no new endpoints. (apex_sql/57_ai_tasks.sql)
// ============================================================
(function () {
    'use strict';

    var STATUSES = ['OPEN', 'IN_PROGRESS', 'BLOCKED', 'DONE'];
    var STATUS_META = {
        OPEN:        { label: 'Open',        color: '#1d4ed8', bg: '#dbeafe', icon: 'fa-inbox' },
        IN_PROGRESS: { label: 'In Progress', color: '#b45309', bg: '#fef3c7', icon: 'fa-spinner' },
        BLOCKED:     { label: 'Blocked',     color: '#b91c1c', bg: '#fee2e2', icon: 'fa-ban' },
        DONE:        { label: 'Done',        color: '#15803d', bg: '#dcfce7', icon: 'fa-circle-check' },
        CANCELLED:   { label: 'Cancelled',   color: '#475569', bg: '#f1f5f9', icon: 'fa-xmark' }
    };
    var PRIO = { 1: ['High', '#dc2626'], 2: ['Medium', '#d97706'], 3: ['Low', '#64748b'] };

    // built-in suggestions shown when the AI is slow / unavailable, so
    // "Assign Tasks" always gives the user something to assign.
    var DEFAULT_SUGGESTIONS = [
        { title: 'Cancel stuck Scheduled / Manual Reservation lines', description: 'Find open trips with order lines in Scheduled or Manual Reservation Required status and cancel them (with their child lines), then report how many.', category: 'Trips', priority: 1, recurrence: 'DAILY', steps: [] },
        { title: 'Auto-print interfaced orders', description: "Print all newly Interfaced orders for today's trips that haven't been printed yet.", category: 'Printing', priority: 2, recurrence: 'DAILY', steps: [] },
        { title: 'Morning trip status sweep', description: 'Review every open trip and summarise status, pending picks and any anomalies.', category: 'Trips', priority: 2, recurrence: 'DAILY', steps: [] },
        { title: 'Failed print jobs review', description: 'List print jobs that failed in the last 24 hours and retry or report them.', category: 'Printing', priority: 2, recurrence: 'DAILY', steps: [] }
    ];

    // Curated catalog of tasks the WMS module commonly does — pick to assign.
    var TASK_LIBRARY = [
        { category: 'Trips', title: 'Cancel stuck Scheduled / Manual Reservation lines', description: 'Find open trips whose order lines are Scheduled or Manual Reservation Required and cancel them (with child lines), then report how many.', priority: 1, recurrence: 'DAILY' },
        { category: 'Trips', title: 'Morning trip status sweep', description: 'Review every open trip and summarise status, pending picks, and any anomalies.', priority: 2, recurrence: 'DAILY' },
        { category: 'Trips', title: 'Close completed trips', description: 'Find trips whose orders are all Interfaced/Shipped and mark/close them.', priority: 3, recurrence: 'DAILY' },
        { category: 'Picking', title: 'Release picks for ready orders', description: 'Release picks for orders that are ready to pick on active trips.', priority: 2, recurrence: 'ONCE' },
        { category: 'Picking', title: 'Picker workload summary', description: 'Show each picker’s assigned vs completed orders for today.', priority: 3, recurrence: 'DAILY' },
        { category: 'Printing', title: 'Auto-print interfaced orders', description: "Print all newly Interfaced orders for today's trips that haven't been printed yet.", priority: 2, recurrence: 'DAILY' },
        { category: 'Printing', title: 'Retry failed print jobs', description: 'List print jobs that failed in the last 24 hours and retry them, then report.', priority: 2, recurrence: 'DAILY' },
        { category: 'Orders', title: 'Orders with cancelled shipment lines', description: 'List today’s orders that have cancelled shipment lines and the reasons.', priority: 3, recurrence: 'DAILY' },
        { category: 'Orders', title: 'Backordered / short-picked report', description: 'Report orders that are backordered or short-picked and need attention.', priority: 2, recurrence: 'DAILY' },
        { category: 'Store / S2V', title: 'Process pending store-to-van transfers', description: 'Find pending S2V transactions for today and process/report them.', priority: 2, recurrence: 'DAILY' },
        { category: 'Inventory', title: 'Low / negative on-hand check', description: 'Report items with low or negative on-hand that could block fulfilment.', priority: 2, recurrence: 'DAILY' },
        { category: 'Monitoring', title: 'Shipping agent activity (24h)', description: 'Summarise what the shipping agent did in the last 24 hours (cancels, prints, errors).', priority: 3, recurrence: 'DAILY' },
        { category: 'Monitoring', title: 'Failed API calls review', description: 'Review WMS_AI_API_LOG for failed calls in the last 24 hours and report patterns.', priority: 3, recurrence: 'DAILY' }
    ];

    var state = { date: todayStr(), assignee: '', search: '', tasks: [], openId: null };
    var _openTask = null;   // the task currently shown in the drawer (for Edit)

    function todayStr() { var d = new Date(); function z(n) { return (n < 10 ? '0' : '') + n; } return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()); }
    function esc2(s) { return (typeof esc === 'function') ? esc(s) : String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function q(s) { return (typeof sqlq === 'function') ? sqlq(s) : ("'" + String(s == null ? '' : s).replace(/'/g, "''") + "'"); }
    function user() { try { return (typeof appUserName === 'function') ? appUserName() : 'USER'; } catch (e) { return 'USER'; } }
    function inst() { try { return (typeof currentInstance === 'function') ? currentInstance() : 'PROD'; } catch (e) { return 'PROD'; } }
    // CLOB-safe literal: chunk long text into TO_CLOB()||TO_CLOB() so we never hit ORA-01704
    function clob(s) {
        s = String(s == null ? '' : s);
        if (!s) return "TO_CLOB('')";
        var parts = [];
        for (var i = 0; i < s.length; i += 3800) parts.push('TO_CLOB(' + q(s.slice(i, i + 3800)) + ')');
        return parts.join(' || ');
    }
    function ref() { return 'T' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

    // ── gateways ────────────────────────────────────────────
    function readSql(sql, cb) {
        sendMessageToCSharp({ action: 'executePost', fullUrl: AI_BASE + '/executequery', body: JSON.stringify({ sql: sql, maxRows: 500, appUser: user() }) }, function (err, data) {
            var d = null; try { d = typeof data === 'string' ? JSON.parse(data) : data; } catch (e) { }
            if (err || !d || d.success !== true) { cb(String(err || (d && d.error) || 'query failed')); return; }
            var ix = {}; (d.columns || []).forEach(function (c, i) { ix[String(c).toUpperCase()] = i; });
            cb(null, (d.rows || []).map(function (r) { var o = {}; Object.keys(ix).forEach(function (k) { o[k] = r[ix[k]]; }); return o; }));
        });
    }
    function writeSql(sql, cb) {
        sendMessageToCSharp({ action: 'executePost', fullUrl: AI_BASE + '/executewrite', body: JSON.stringify({ sql: sql, appUser: user() }) }, function (err, data) {
            var ok = !err; var d = null; try { d = typeof data === 'string' ? JSON.parse(data) : data; } catch (e) { }
            if (d && d.success === false) { ok = false; err = d.error; }
            if (cb) cb(ok ? null : String(err || 'write failed'));
        });
    }
    function logEvent(taskId, actor, kind, message, cb) {
        writeSql('INSERT INTO wms_ai_task_events (task_id, actor, kind, message) VALUES (' +
            parseInt(taskId, 10) + ', ' + q(actor) + ', ' + q(kind) + ', ' + clob(message) + ')', cb);
    }

    // ── load / render ───────────────────────────────────────
    function rollDaily(cb) {
        // clone the latest instance of each DAILY task into today, if missing
        if (state.date !== todayStr()) { cb && cb(); return; }
        var sql =
            "INSERT INTO wms_ai_tasks (client_ref, title, description, assignee, category, priority, task_date, recurrence, status, instance, created_by, created_date) " +
            "SELECT 'ROLL-'||t.task_id||'-'||TO_CHAR(SYSDATE,'YYYYMMDD'), t.title, t.description, t.assignee, t.category, t.priority, TRUNC(SYSDATE), 'DAILY', 'OPEN', t.instance, 'AUTO-ROLL', SYSDATE " +
            "FROM wms_ai_tasks t WHERE t.recurrence='DAILY' AND t.task_date < TRUNC(SYSDATE) " +
            "AND t.task_date = (SELECT MAX(t2.task_date) FROM wms_ai_tasks t2 WHERE t2.title=t.title AND t2.recurrence='DAILY') " +
            "AND NOT EXISTS (SELECT 1 FROM wms_ai_tasks x WHERE x.title=t.title AND x.recurrence='DAILY' AND x.task_date=TRUNC(SYSDATE))";
        writeSql(sql, function () { cb && cb(); });
    }

    function load() {
        buildShell();
        rollDaily(function () {
            var where = "task_date = TO_DATE(" + q(state.date) + ",'YYYY-MM-DD')";
            if (state.assignee) where += " AND assignee = " + q(state.assignee);
            var sql = "SELECT task_id, title, SUBSTR(description,1,240) AS desc_short, assignee, category, priority, " +
                "recurrence, status, TO_CHAR(due_at,'HH24:MI') AS due_t, created_by, TO_CHAR(trip_date,'YYYY-MM-DD') AS trip_date_s, " +
                "TO_CHAR(created_date,'YYYY-MM-DD HH24:MI') AS created, SUBSTR(issue,1,200) AS issue_short " +
                "FROM wms_ai_tasks WHERE " + where + " AND status <> 'CANCELLED' ORDER BY priority, task_id";
            readSql(sql, function (err, rows) {
                state.tasks = err ? [] : rows;
                renderBoard(err);
            });
        });
    }

    function buildShell() {
        var page = document.getElementById('page-tasks');
        if (!page || page.getAttribute('data-built')) return;
        page.setAttribute('data-built', '1');
        page.innerHTML =
            '<div style="padding:14px 18px;height:100%;overflow:auto;">' +
              '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;">' +
                '<div style="font-size:16px;font-weight:800;color:#0f172a;"><i class="fas fa-list-check" style="color:#7c3aed;"></i> Daily Tasks</div>' +
                '<input type="date" id="tsk-date" value="' + state.date + '" onchange="Tasks.setDate(this.value)" style="padding:5px 8px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;">' +
                '<button onclick="Tasks.setDate(\'' + todayStr() + '\')" style="border:1px solid #e2e8f0;background:#f8fafc;border-radius:8px;padding:5px 10px;font-size:11px;font-weight:700;cursor:pointer;color:#475569;">Today</button>' +
                '<input id="tsk-search" placeholder="Search…" oninput="Tasks.search(this.value)" style="padding:5px 9px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;flex:1;min-width:120px;">' +
                '<button onclick="Tasks.refresh()" title="Refresh" style="border:1px solid #e2e8f0;background:#f8fafc;border-radius:8px;padding:5px 10px;font-size:11px;cursor:pointer;color:#0e7490;"><i class="fas fa-sync-alt"></i></button>' +
                '<button onclick="Tasks.openLibrary()" style="border:1px solid #7c3aed;background:#f5f3ff;color:#6d28d9;border-radius:8px;padding:6px 13px;font-size:12px;font-weight:800;cursor:pointer;"><i class="fas fa-book-open"></i> Task Library</button>' +
                '<button onclick="Tasks.openCreate()" style="border:none;background:#7c3aed;color:#fff;border-radius:8px;padding:6px 13px;font-size:12px;font-weight:800;cursor:pointer;"><i class="fas fa-plus"></i> New Task</button>' +
              '</div>' +
              '<div id="tsk-dash" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;"></div>' +
              '<div id="tsk-board" style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;align-items:start;"></div>' +
            '</div>';
    }

    function renderDash() {
        var el = document.getElementById('tsk-dash'); if (!el) return;
        var counts = { OPEN: 0, IN_PROGRESS: 0, BLOCKED: 0, DONE: 0 };
        state.tasks.forEach(function (t) { if (counts[t.STATUS] !== undefined) counts[t.STATUS]++; });
        el.innerHTML = STATUSES.map(function (s) {
            var m = STATUS_META[s];
            return '<span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:800;color:' + m.color + ';background:' + m.bg + ';border-radius:20px;padding:4px 12px;">' +
                '<i class="fas ' + m.icon + '"></i> ' + m.label + ' <b style="font-size:13px;">' + counts[s] + '</b></span>';
        }).join('');
    }

    function userName() {
        try {
            var n = (typeof appUserName === 'function' ? appUserName() : '') || localStorage.getItem('loggedInUser') || '';
            n = String(n || '').split('@')[0].replace(/[._]+/g, ' ').trim();
            if (!n || n.toUpperCase() === 'UNKNOWN') return '';
            return n.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
        } catch (e) { return ''; }
    }
    function heroHtml() {
        var name = userName();
        var hi = 'Hi' + (name ? ', ' + esc2(name) : '') + ' 👋';
        return '<div style="grid-column:1/-1;">' +
            '<div style="background:linear-gradient(135deg,#7c3aed 0%,#0891b2 100%);border-radius:16px;padding:26px 26px 22px;color:#fff;box-shadow:0 10px 30px rgba(124,58,237,.25);">' +
              '<div style="display:flex;align-items:center;gap:14px;">' +
                '<div style="width:52px;height:52px;border-radius:14px;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0;"><i class="fas fa-robot"></i></div>' +
                '<div><div style="font-size:19px;font-weight:800;">' + hi + '</div>' +
                  '<div style="font-size:13px;opacity:.92;margin-top:2px;">I\'m your <b>AI Digital Assistant</b>. What can I do for you today?</div></div>' +
              '</div>' +
              '<div style="font-size:12.5px;opacity:.9;margin-top:16px;line-height:1.6;">You have no tasks for <b>' + esc2(state.date) + '</b>. I can check the warehouse right now and suggest a list of tasks for you to assign to me — trips needing attention, stuck lines, orders to print, and more.</div>' +
              '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:18px;">' +
                '<button onclick="Tasks.assignWizard()" style="border:none;background:#fff;color:#6d28d9;border-radius:10px;padding:11px 20px;font-size:13.5px;font-weight:800;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.15);"><i class="fas fa-wand-magic-sparkles"></i> Assign Tasks</button>' +
                '<button onclick="Tasks.openCreate()" style="border:1px solid rgba(255,255,255,.6);background:transparent;color:#fff;border-radius:10px;padding:11px 18px;font-size:13.5px;font-weight:700;cursor:pointer;"><i class="fas fa-plus"></i> New Task manually</button>' +
              '</div>' +
            '</div>' +
            '<div style="text-align:center;font-size:11px;color:#94a3b8;margin-top:14px;"><i class="fas fa-lightbulb" style="color:#f59e0b;"></i> Tip: tasks you assign are tracked here with a full activity timeline, and the AI records everything it does.</div>' +
        '</div>';
    }

    function renderBoard(err) {
        var el = document.getElementById('tsk-board'); if (!el) return;
        if (err) { renderDash(); el.innerHTML = '<div style="grid-column:1/-1;color:#b91c1c;font-size:12px;">Could not load tasks: ' + esc2(err) + '<br><span style="color:#94a3b8;">Has apex_sql/57_ai_tasks.sql been run?</span></div>'; return; }
        // friendly assistant welcome when there is nothing assigned for the day
        if (!state.tasks.length) { var dash = document.getElementById('tsk-dash'); if (dash) dash.innerHTML = ''; el.innerHTML = heroHtml(); return; }
        renderDash();
        var qs = state.search.toLowerCase();
        var byStatus = { OPEN: [], IN_PROGRESS: [], BLOCKED: [], DONE: [] };
        state.tasks.forEach(function (t) {
            if (qs && (String(t.TITLE || '') + ' ' + String(t.CATEGORY || '') + ' ' + String(t.ASSIGNEE || '')).toLowerCase().indexOf(qs) < 0) return;
            if (byStatus[t.STATUS]) byStatus[t.STATUS].push(t);
        });
        el.innerHTML = STATUSES.map(function (s) {
            var m = STATUS_META[s], list = byStatus[s] || [];
            return '<div style="background:#f8fafc;border:1px solid #eef2f7;border-radius:12px;padding:8px;min-height:80px;">' +
                '<div style="font-size:11px;font-weight:800;color:' + m.color + ';text-transform:uppercase;letter-spacing:.4px;padding:4px 6px 8px;"><i class="fas ' + m.icon + '"></i> ' + m.label + ' (' + list.length + ')</div>' +
                (list.map(taskCard).join('') || '<div style="font-size:11px;color:#cbd5e1;padding:6px;">—</div>') + '</div>';
        }).join('');
    }

    function taskCard(t) {
        var p = PRIO[t.PRIORITY] || PRIO[2];
        return '<div onclick="Tasks.open(' + t.TASK_ID + ')" style="background:#fff;border:1px solid #e6eaf2;border-radius:10px;padding:9px 11px;margin-bottom:8px;cursor:pointer;box-shadow:0 1px 2px rgba(15,23,42,.04);">' +
            '<div style="display:flex;align-items:center;gap:6px;">' +
                '<span title="' + p[0] + ' priority" style="width:8px;height:8px;border-radius:50%;background:' + p[1] + ';flex-shrink:0;"></span>' +
                '<span style="font-size:12.5px;font-weight:700;color:#0f172a;line-height:1.3;">' + esc2(t.TITLE) + '</span>' +
            '</div>' +
            (t.DESC_SHORT ? '<div style="font-size:10.5px;color:#94a3b8;margin-top:3px;line-height:1.4;">' + esc2(String(t.DESC_SHORT).slice(0, 90)) + (String(t.DESC_SHORT).length > 90 ? '…' : '') + '</div>' : '') +
            (t.STATUS === 'BLOCKED' && t.ISSUE_SHORT ? '<div style="font-size:10px;color:#b91c1c;margin-top:4px;"><i class="fas fa-triangle-exclamation"></i> ' + esc2(t.ISSUE_SHORT) + '</div>' : '') +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;font-size:9.5px;color:#64748b;">' +
                (t.CATEGORY ? '<span style="background:#eef2ff;color:#4338ca;border-radius:6px;padding:1px 6px;">' + esc2(t.CATEGORY) + '</span>' : '') +
                '<span><i class="fas fa-user-astronaut" style="font-size:8px;"></i> ' + esc2(t.ASSIGNEE || '') + '</span>' +
                (t.TRIP_DATE_S ? '<span style="background:#ecfeff;color:#0e7490;border-radius:6px;padding:1px 6px;font-weight:700;"><i class="fas fa-truck" style="font-size:8px;"></i> ' + esc2(t.TRIP_DATE_S) + '</span>' : '') +
                (t.RECURRENCE === 'DAILY' ? '<span style="color:#7c3aed;"><i class="fas fa-repeat" style="font-size:8px;"></i> daily</span>' : '') +
                (t.DUE_T ? '<span><i class="fas fa-clock" style="font-size:8px;"></i> ' + esc2(t.DUE_T) + '</span>' : '') +
            '</div></div>';
    }

    // ── task detail drawer (with timeline) ──────────────────
    function open(id) {
        state.openId = id;
        var sql = "SELECT task_id, title, description, assignee, category, priority, recurrence, status, " +
            "TO_CHAR(task_date,'YYYY-MM-DD') AS task_date, TO_CHAR(trip_date,'YYYY-MM-DD') AS trip_date, TO_CHAR(due_at,'YYYY-MM-DD HH24:MI') AS due_at, " +
            "TO_CHAR(created_date,'YYYY-MM-DD HH24:MI') AS created, created_by, " +
            "TO_CHAR(started_at,'YYYY-MM-DD HH24:MI') AS started, TO_CHAR(completed_at,'YYYY-MM-DD HH24:MI') AS completed, " +
            "action_json, completion_sql, last_run_status, TO_CHAR(last_run_at,'YYYY-MM-DD HH24:MI') AS last_run, " +
            "issue, result FROM wms_ai_tasks WHERE task_id = " + parseInt(id, 10);
        readSql(sql, function (err, rows) {
            if (err || !rows.length) { alert('Could not load task: ' + (err || 'not found')); return; }
            readSql("SELECT event_id, TO_CHAR(event_time,'YYYY-MM-DD HH24:MI:SS') AS t, actor, kind, SUBSTR(message,1,4000) AS message FROM wms_ai_task_events WHERE task_id = " + parseInt(id, 10) + " ORDER BY event_id DESC",
                function (e2, evs) { renderDrawer(rows[0], evs || []); });
        });
    }

    function renderDrawer(t, events) {
        _openTask = t;
        document.getElementById('tsk-drawer')?.remove();
        var m = STATUS_META[t.STATUS] || STATUS_META.OPEN;
        var p = PRIO[t.PRIORITY] || PRIO[2];
        var actions = '';
        if (t.STATUS !== 'IN_PROGRESS' && t.STATUS !== 'DONE') actions += drawerBtn('Start', 'IN_PROGRESS', '#b45309');
        if (t.STATUS !== 'DONE') actions += drawerBtn('Done', 'DONE', '#15803d');
        if (t.STATUS !== 'BLOCKED' && t.STATUS !== 'DONE') actions += drawerBtn('Block', 'BLOCKED', '#b91c1c');
        if (t.STATUS === 'DONE' || t.STATUS === 'BLOCKED') actions += drawerBtn('Reopen', 'OPEN', '#1d4ed8');

        var steps = parseSteps(t.ACTION_JSON);
        var execHtml = '';
        if (steps && steps.length) {
            execHtml =
                '<div style="border:1px solid #cffafe;background:#f0fdff;border-radius:8px;padding:8px 10px;margin-bottom:12px;">' +
                  '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
                    '<span style="font-size:11px;font-weight:800;color:#0e7490;"><i class="fas fa-bolt"></i> Executable · ' + steps.length + ' step(s)</span>' +
                    (t.LAST_RUN ? '<span style="font-size:10px;color:#64748b;">last run ' + esc2(t.LAST_RUN) + ' · ' + esc2(t.LAST_RUN_STATUS || '') + '</span>' : '') +
                    '<button onclick="Tasks.execute(' + t.TASK_ID + ')" style="margin-left:auto;border:none;background:#0891b2;color:#fff;border-radius:8px;padding:6px 13px;font-size:12px;font-weight:800;cursor:pointer;"><i class="fas fa-play"></i> Execute now</button>' +
                  '</div>' +
                  '<details style="margin-top:6px;"><summary style="font-size:10px;color:#0e7490;cursor:pointer;">view steps</summary>' +
                    '<pre style="background:#0f172a;color:#d1e7ff;border-radius:6px;padding:8px;font-size:10px;max-height:180px;overflow:auto;margin:6px 0 0;">' + esc2(JSON.stringify(steps, null, 2)) + '</pre></details>' +
                '</div>';
        }

        var timeline = events.length ? events.map(eventRow).join('') :
            '<div style="font-size:11px;color:#94a3b8;padding:6px;">No activity recorded yet.</div>';

        var html =
        '<div id="tsk-drawer" style="position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:1000;display:flex;justify-content:flex-end;" onclick="if(event.target===this)this.remove()">' +
          '<div style="background:#fff;width:560px;max-width:96vw;height:100%;display:flex;flex-direction:column;box-shadow:-8px 0 40px rgba(0,0,0,.2);">' +
            '<div style="padding:14px 18px;border-bottom:1px solid #eef2f7;display:flex;align-items:flex-start;gap:10px;">' +
              '<span style="width:10px;height:10px;border-radius:50%;background:' + p[1] + ';margin-top:5px;flex-shrink:0;"></span>' +
              '<div style="flex:1;min-width:0;"><div style="font-size:15px;font-weight:800;color:#0f172a;">' + esc2(t.TITLE) + '</div>' +
                '<div style="font-size:11px;color:#64748b;margin-top:2px;">#' + t.TASK_ID + ' · ' + esc2(t.CATEGORY || 'General') + ' · ' + esc2(t.ASSIGNEE || '') + (t.RECURRENCE === 'DAILY' ? ' · daily' : '') + '</div>' +
                  '<div style="font-size:10.5px;color:#0e7490;margin-top:3px;font-weight:700;"><i class="fas fa-truck"></i> Works on trip date: ' + esc2(t.TRIP_DATE || t.TASK_DATE || '—') + '</div></div>' +
              '<span style="font-size:10px;font-weight:800;color:' + m.color + ';background:' + m.bg + ';border-radius:8px;padding:3px 9px;"><i class="fas ' + m.icon + '"></i> ' + m.label + '</span>' +
              '<button onclick="document.getElementById(\'tsk-drawer\').remove()" style="background:none;border:none;font-size:18px;color:#94a3b8;cursor:pointer;">×</button>' +
            '</div>' +
            '<div style="flex:1;overflow-y:auto;padding:14px 18px;">' +
              (t.DESCRIPTION ? '<div style="font-size:12.5px;color:#334155;line-height:1.6;white-space:pre-wrap;margin-bottom:12px;">' + esc2(t.DESCRIPTION) + '</div>' : '') +
              '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">' + actions +
                '<button onclick="Tasks.runAI(' + t.TASK_ID + ')" style="border:none;background:#0891b2;color:#fff;border-radius:8px;padding:6px 13px;font-size:12px;font-weight:800;cursor:pointer;"><i class="fas fa-robot"></i> Run with AI</button>' +
                '<button onclick="Tasks.openEdit(' + t.TASK_ID + ')" style="border:1px solid #e2e8f0;background:#fff;color:#475569;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:800;cursor:pointer;"><i class="fas fa-pen"></i> Edit</button>' +
              '</div>' +
              execHtml +
              (t.STATUS === 'BLOCKED' && t.ISSUE ? '<div style="background:#fff1f2;border:1px solid #fecaca;border-radius:8px;padding:8px 10px;font-size:11.5px;color:#b91c1c;margin-bottom:12px;"><b>Issue:</b> ' + esc2(t.ISSUE) + '</div>' : '') +
              (t.RESULT ? '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:8px 10px;font-size:11.5px;color:#166534;margin-bottom:12px;"><b>Result:</b> ' + esc2(t.RESULT) + '</div>' : '') +
              '<div style="display:flex;gap:6px;margin-bottom:12px;">' +
                '<input id="tsk-note-in" placeholder="Add a note / progress / issue…" style="flex:1;padding:7px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;">' +
                '<button onclick="Tasks.addEvent(' + t.TASK_ID + ',\'NOTE\')" style="border:1px solid #e2e8f0;background:#f8fafc;border-radius:8px;padding:0 12px;font-size:11px;font-weight:700;cursor:pointer;color:#334155;">Note</button>' +
                '<button onclick="Tasks.addEvent(' + t.TASK_ID + ',\'ISSUE\')" style="border:1px solid #fecaca;background:#fff1f2;border-radius:8px;padding:0 12px;font-size:11px;font-weight:700;cursor:pointer;color:#b91c1c;">Issue</button>' +
              '</div>' +
              '<div style="font-size:10px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin:4px 2px 8px;"><i class="fas fa-timeline"></i> Activity &amp; traceability</div>' +
              '<div>' + timeline + '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
        document.body.insertAdjacentHTML('beforeend', html);
    }
    function drawerBtn(label, toStatus, color) {
        return '<button onclick="Tasks.setStatus(' + state.openId + ',\'' + toStatus + '\')" style="border:1px solid ' + color + ';background:#fff;color:' + color + ';border-radius:8px;padding:6px 12px;font-size:12px;font-weight:800;cursor:pointer;">' + label + '</button>';
    }
    function eventRow(e) {
        var kindColor = { ISSUE: '#b91c1c', RESULT: '#15803d', STATUS: '#7c3aed', PROGRESS: '#b45309', CREATE: '#1d4ed8', NOTE: '#475569', ASSIGN: '#0e7490' }[e.KIND] || '#475569';
        var actorIcon = e.ACTOR === 'AI' ? 'fa-robot' : (e.ACTOR === 'SYSTEM' ? 'fa-gear' : 'fa-user');
        return '<div style="border-left:2px solid ' + kindColor + ';padding:4px 0 8px 10px;margin-left:4px;">' +
            '<div style="font-size:9.5px;color:#94a3b8;"><i class="fas ' + actorIcon + '"></i> ' + esc2(e.ACTOR || '') + ' · <span style="font-weight:800;color:' + kindColor + ';">' + esc2(e.KIND || '') + '</span> · ' + esc2(e.T || '') + '</div>' +
            '<div style="font-size:12px;color:#334155;line-height:1.5;white-space:pre-wrap;margin-top:2px;">' + esc2(e.MESSAGE || '') + '</div></div>';
    }

    // ── mutations ───────────────────────────────────────────
    function setStatus(id, s) {
        var sets = ['status = ' + q(s), 'updated_by = ' + q(user()), 'updated_date = SYSDATE'];
        if (s === 'IN_PROGRESS') sets.push('started_at = NVL(started_at, SYSDATE)');
        if (s === 'DONE') sets.push('completed_at = SYSDATE');
        if (s === 'OPEN') sets.push('completed_at = NULL');
        writeSql('UPDATE wms_ai_tasks SET ' + sets.join(', ') + ' WHERE task_id = ' + parseInt(id, 10), function (err) {
            if (err) { alert('Update failed: ' + err); return; }
            logEvent(id, 'USER', 'STATUS', 'Status → ' + s, function () { open(id); load(); });
        });
    }
    function addEvent(id, kind) {
        var inp = document.getElementById('tsk-note-in');
        var msg = (inp ? inp.value : '').trim();
        if (!msg) { if (inp) inp.focus(); return; }
        var extra = '';
        if (kind === 'ISSUE') extra = ', issue = ' + clob(msg) + ', status = CASE WHEN status = \'DONE\' THEN status ELSE \'BLOCKED\' END';
        writeSql('UPDATE wms_ai_tasks SET updated_by = ' + q(user()) + ', updated_date = SYSDATE' + extra + ' WHERE task_id = ' + parseInt(id, 10), function () {
            logEvent(id, 'USER', kind, msg, function () { open(id); load(); });
        });
    }

    // ── run with AI (records what the AI did on the task) ───
    function runAI(id) {
        var t = null; readSql("SELECT title, description, TO_CHAR(NVL(trip_date, task_date),'YYYY-MM-DD') AS trip_date FROM wms_ai_tasks WHERE task_id = " + parseInt(id, 10), function (err, rows) {
            if (err || !rows.length) { alert('Task not found'); return; }
            t = rows[0];
            logEvent(id, 'SYSTEM', 'PROGRESS', 'Handed to AI Digital Employee to work on (trip date ' + (t.TRIP_DATE || '') + ').', function () {
                setStatus_silent(id, 'IN_PROGRESS');
                aiProgressStart('AI working: ' + (t.TITLE || 'task') + ' · trip ' + (t.TRIP_DATE || ''));
                window._taskAiProgress = function (evt) {
                    if (evt.eventType === 'status') aiProgressLine(evt.text || '');
                    else if (evt.eventType === 'sqlRound') aiProgressLine((evt.kind === 'fusion' ? 'Fusion ' + (evt.method || '') : 'SQL round ' + (evt.round || '')) + ': ' + (evt.success ? ((evt.rowCount != null ? evt.rowCount + ' rows' : 'ok') + ' in ' + (evt.elapsedMs || 0) + 'ms') : 'error — retrying'));
                };
                var prompt = 'You are working an assigned WORK TASK. Do it using your tools, then give a concise result. ' +
                    'If you cannot complete it, clearly state the ISSUE and what is blocking.\n' +
                    'IMPORTANT: work ONLY on the TRIP DATE ' + (t.TRIP_DATE || '') + ' — restrict every query/action to trips/orders whose trip date is ' + (t.TRIP_DATE || '') + '. Do not touch other dates.\n\n' +
                    'TASK: ' + (t.TITLE || '') + '\nTRIP DATE: ' + (t.TRIP_DATE || '') + '\nDETAILS: ' + (t.DESCRIPTION || '');
                if (typeof window.aiAsk !== 'function') { aiProgressStop(); alert('AI helper unavailable'); return; }
                window.aiAsk(prompt, function (e2, md) {
                    aiProgressStop();
                    md = md || (e2 ? ('AI error: ' + e2) : 'No response');
                    logEvent(id, 'AI', 'RESULT', md, function () {
                        // store the AI summary as the task result
                        writeSql('UPDATE wms_ai_tasks SET result = ' + clob(md.slice(0, 8000)) + ', updated_by = ' + q('AI') + ', updated_date = SYSDATE WHERE task_id = ' + parseInt(id, 10), function () {
                            if (state.openId === id) open(id); load();
                        });
                    });
                });
            });
        });
    }
    function setStatus_silent(id, s) {
        var sets = ['status = ' + q(s), 'started_at = NVL(started_at, SYSDATE)', 'updated_by = ' + q('AI'), 'updated_date = SYSDATE'];
        writeSql('UPDATE wms_ai_tasks SET ' + sets.join(', ') + ' WHERE task_id = ' + parseInt(id, 10) + " AND status = 'OPEN'", function () { });
    }

    function parseSteps(aj) {
        if (!aj) return [];
        try { var o = typeof aj === 'string' ? JSON.parse(aj) : aj; var s = Array.isArray(o) ? o : (o.steps || []); return Array.isArray(s) ? s : []; } catch (e) { return []; }
    }

    // ── live progress toast (so you can SEE the AI working) ────────
    function aiProgressStart(title) {
        document.getElementById('tsk-progress')?.remove();
        document.body.insertAdjacentHTML('beforeend',
            '<div id="tsk-progress" style="position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:1100;background:#0f172a;color:#e2e8f0;border-radius:12px;box-shadow:0 14px 44px rgba(0,0,0,.45);width:460px;max-width:94vw;overflow:hidden;">' +
              '<div style="padding:11px 14px;display:flex;align-items:center;gap:9px;border-bottom:1px solid #1e293b;">' +
                '<i class="fas fa-robot" style="color:#22d3ee;"></i>' +
                '<span style="font-size:12.5px;font-weight:800;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc2(title) + '</span>' +
                '<i class="fas fa-circle-notch fa-spin" style="color:#22d3ee;"></i>' +
              '</div>' +
              '<div id="tsk-progress-log" style="max-height:180px;overflow:auto;padding:8px 14px;font-size:11px;line-height:1.65;font-family:Consolas,monospace;color:#94e2d5;"></div>' +
            '</div>');
        aiProgressLine('starting…');
    }
    function aiProgressLine(text) {
        var log = document.getElementById('tsk-progress-log'); if (!log || !text) return;
        var d = document.createElement('div'); d.textContent = '• ' + text;
        log.appendChild(d); log.scrollTop = log.scrollHeight;
        while (log.childNodes.length > 80) log.removeChild(log.firstChild);
    }
    function aiProgressStop() { var p = document.getElementById('tsk-progress'); if (p) p.remove(); window._taskAiProgress = null; }

    // ── execute a task's steps (via the shared LOCAL job runner) ───
    function execute(id) {
        if (!window.LocalJobRunner) { alert('The step runner is not available.'); return; }
        readSql("SELECT action_json, completion_sql, TO_CHAR(NVL(trip_date, task_date),'YYYY-MM-DD') AS trip_date FROM wms_ai_tasks WHERE task_id = " + parseInt(id, 10), function (err, rows) {
            if (err || !rows.length) { alert('Task not found'); return; }
            var steps = parseSteps(rows[0].ACTION_JSON);
            if (!steps.length) { alert('This task has no executable steps.'); return; }
            var tripDate = rows[0].TRIP_DATE || state.date;
            var completion = String(rows[0].COMPLETION_SQL || '').replace(/[{#]TRIP_DATE[}#]/g, tripDate);
            logEvent(id, 'SYSTEM', 'PROGRESS', 'Executing ' + steps.length + ' step(s) for trip date ' + tripDate + '…', function () {
                setStatus_silentTo(id, 'IN_PROGRESS');
                aiProgressStart('Executing ' + steps.length + ' step(s) · trip ' + tripDate);
                LocalJobRunner.runSteps(steps, { vars: { TRIP_DATE: tripDate } }, aiProgressLine).then(function (res) {
                    aiProgressStop();
                    var finish = function (done) {
                        var logText = (res.log || []).join('\n');
                        var newStatus = res.ok ? (done === false ? 'IN_PROGRESS' : 'DONE') : 'BLOCKED';
                        var sets = ['last_run_status = ' + q(res.ok ? 'SUCCESS' : 'FAILED'), 'last_run_at = SYSDATE',
                            'status = ' + q(newStatus), 'updated_by = ' + q('AI'), 'updated_date = SYSDATE',
                            'result = ' + clob(logText.slice(0, 8000))];
                        if (newStatus === 'DONE') sets.push('completed_at = SYSDATE');
                        if (!res.ok) sets.push('issue = ' + clob(res.error || 'execution failed'));
                        writeSql('UPDATE wms_ai_tasks SET ' + sets.join(', ') + ' WHERE task_id = ' + parseInt(id, 10), function () {
                            logEvent(id, 'AI', res.ok ? 'RESULT' : 'ISSUE', logText || (res.error || ''), function () { if (state.openId === id) open(id); load(); });
                        });
                    };
                    if (res.ok && completion) LocalJobRunner.completionCount(completion).then(function (n) { finish(n === 0); });
                    else finish(true);
                });
            });
        });
    }
    function setStatus_silentTo(id, s) {
        writeSql('UPDATE wms_ai_tasks SET status = ' + q(s) + ', started_at = NVL(started_at, SYSDATE), updated_by = ' + q('AI') + ', updated_date = SYSDATE WHERE task_id = ' + parseInt(id, 10), function () { });
    }

    // ── AI builds the task definition (fetches what it needs) ──────
    function buildWithAI() {
        var goalEl = document.getElementById('tc-goal');
        var goal = (goalEl ? goalEl.value : '').trim();
        var note = document.getElementById('tc-ai-note');
        if (!goal) { if (goalEl) goalEl.focus(); return; }
        if (note) note.innerHTML = '<span style="color:#0e7490;"><i class="fas fa-circle-notch fa-spin"></i> AI is building the task…</span>';
        var prompt =
            'Build an EXECUTABLE WMS task definition for the goal below. First fetch anything you need (query the DB / API catalog for the right tables, columns, ORDS URLs). ' +
            'Reply with ONLY a single ```json code block, no prose, of the form:\n' +
            '{"title":"","description":"","category":"","priority":2,"recurrence":"ONCE","completionSql":"","steps":[ ... ]}\n' +
            'Steps use these types (same as a LOCAL scheduled job): ' +
            'query{sql,extract{VAR:"COLUMN"}}, rest{method,url,body,extract{VAR:"items[1].X"}}, print{orderNumber,tripId}, download_pdf{orderNumber,tripId}, forEach{query:{sql},do:[...]}, ipc{action,params}. ' +
            'Use {VAR} placeholders, REAL ORDS URLs from the catalog and REAL table/column names. completionSql is optional (a plain SELECT; 0 rows = done). recurrence is ONCE or DAILY. ' +
            'IMPORTANT: scope every query/action to the task\'s TRIP DATE using the {TRIP_DATE} placeholder (YYYY-MM-DD), e.g. WHERE trip_date = TO_DATE(\'{TRIP_DATE}\',\'YYYY-MM-DD\') — the app fills it at run time.\n\nGOAL: ' + goal;
        if (typeof window.aiAsk !== 'function') { if (note) note.innerHTML = '<span style="color:#b91c1c;">AI helper unavailable.</span>'; return; }
        window.aiAsk(prompt, function (err, md) {
            if (err) { if (note) note.innerHTML = '<span style="color:#b91c1c;">AI: ' + esc2(String(err)) + '</span>'; return; }
            var def = extractTaskDef(md);
            if (!def) { if (note) note.innerHTML = '<span style="color:#b45309;">Could not parse a task from the AI. Try rephrasing the goal.</span>'; return; }
            fillCreateForm(def);
            if (note) note.innerHTML = '<span style="color:#166534;"><i class="fas fa-check"></i> Task drafted — review below and Create.</span>';
        });
    }
    function extractTaskDef(md) {
        if (!md) return null;
        var m = md.match(/```json\s*([\s\S]*?)```/i) || md.match(/(\{[\s\S]*\})/);
        if (!m) return null;
        try { return JSON.parse(m[1]); } catch (e) { return null; }
    }
    function fillCreateForm(def) {
        var set = function (id, v) { var e = document.getElementById(id); if (e && v != null) e.value = v; };
        set('tc-title', def.title || '');
        set('tc-desc', def.description || '');
        set('tc-category', def.category || '');
        if (def.priority) set('tc-prio', String(def.priority));
        if (def.recurrence) set('tc-recur', String(def.recurrence).toUpperCase() === 'DAILY' ? 'DAILY' : 'ONCE');
        set('tc-completion', def.completionSql || def.completion_sql || '');
        var steps = def.steps || (def.action && def.action.steps);
        if (steps) set('tc-steps', JSON.stringify({ steps: steps }, null, 2));
    }

    // ── create ──────────────────────────────────────────────
    function openCreate() {
        document.getElementById('tsk-create')?.remove();
        var html =
        '<div id="tsk-create" style="position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:1001;display:flex;align-items:center;justify-content:center;padding:16px;" onclick="if(event.target===this)this.remove()">' +
          '<div style="background:#fff;border-radius:14px;width:520px;max-width:96vw;max-height:90vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.3);">' +
            '<div style="padding:14px 18px;border-bottom:1px solid #eef2f7;font-size:15px;font-weight:800;color:#0f172a;"><i class="fas fa-plus" style="color:#7c3aed;"></i> New Task</div>' +
            '<div style="padding:16px 18px;display:flex;flex-direction:column;gap:10px;">' +
              '<div style="background:#f0fdff;border:1px solid #cffafe;border-radius:10px;padding:10px 12px;">' +
                '<div style="font-size:11px;font-weight:800;color:#0e7490;margin-bottom:5px;"><i class="fas fa-robot"></i> Let AI build it</div>' +
                '<div style="display:flex;gap:6px;">' +
                  '<input id="tc-goal" placeholder="Describe the goal, e.g. cancel Scheduled lines on all open trips" style="' + inCss() + '">' +
                  '<button onclick="Tasks.buildWithAI()" style="border:none;background:#0891b2;color:#fff;border-radius:8px;padding:0 14px;font-size:12px;font-weight:800;cursor:pointer;white-space:nowrap;">Build</button>' +
                '</div>' +
                '<div id="tc-ai-note" style="font-size:10.5px;margin-top:5px;min-height:14px;"></div>' +
              '</div>' +
              fld('Title', '<input id="tc-title" style="' + inCss() + '" placeholder="e.g. Cancel stuck lines on today\'s trips">') +
              fld('Details / instructions', '<textarea id="tc-desc" style="' + inCss() + 'min-height:80px;resize:vertical;" placeholder="What exactly should be done, and how to know it is complete."></textarea>') +
              '<div style="display:flex;gap:10px;flex-wrap:wrap;">' +
                fld('Assignee', '<input id="tc-assignee" value="AI Digital Employee" style="' + inCss() + '">', 1) +
                fld('Category', '<input id="tc-category" placeholder="Trips / Printing / …" style="' + inCss() + '">', 1) +
              '</div>' +
              '<div style="display:flex;gap:10px;flex-wrap:wrap;">' +
                fld('Priority', '<select id="tc-prio" style="' + inCss() + '"><option value="1">High</option><option value="2" selected>Medium</option><option value="3">Low</option></select>', 1) +
                fld('List date', '<input id="tc-date" type="date" value="' + state.date + '" style="' + inCss() + '">', 1) +
                fld('Repeat', '<select id="tc-recur" style="' + inCss() + '"><option value="ONCE" selected>Once</option><option value="DAILY">Daily</option></select>', 1) +
              '</div>' +
              '<div style="background:#ecfeff;border:1px solid #cffafe;border-radius:10px;padding:9px 11px;">' +
                fld('<i class="fas fa-truck" style="color:#0e7490;"></i> Trip date — the AI works ONLY on this trip date', '<input id="tc-trip" type="date" value="' + state.date + '" style="' + inCss() + '">') +
              '</div>' +
              '<details><summary style="font-size:11px;font-weight:700;color:#0e7490;cursor:pointer;"><i class="fas fa-bolt"></i> Executable steps (optional — makes the task runnable)</summary>' +
                '<div style="margin-top:8px;display:flex;flex-direction:column;gap:8px;">' +
                  fld('Steps (JSON: {"steps":[…]})', '<textarea id="tc-steps" style="' + inCss() + 'min-height:90px;font-family:Consolas,monospace;font-size:11px;resize:vertical;" placeholder=\'{"steps":[{"type":"query","sql":"SELECT ..."}]}\'></textarea>') +
                  fld('Completion SQL (optional — 0 rows = done)', '<input id="tc-completion" style="' + inCss() + '" placeholder="SELECT 1 FROM ... WHERE still_pending">') +
                '</div>' +
              '</details>' +
            '</div>' +
            '<div style="padding:12px 18px;border-top:1px solid #eef2f7;display:flex;justify-content:flex-end;gap:8px;">' +
              '<button onclick="document.getElementById(\'tsk-create\').remove()" style="border:1px solid #e2e8f0;background:#fff;border-radius:8px;padding:7px 14px;font-size:12px;font-weight:700;cursor:pointer;color:#64748b;">Cancel</button>' +
              '<button onclick="Tasks.create()" style="border:none;background:#7c3aed;color:#fff;border-radius:8px;padding:7px 16px;font-size:12px;font-weight:800;cursor:pointer;">Create Task</button>' +
            '</div>' +
          '</div>' +
        '</div>';
        document.body.insertAdjacentHTML('beforeend', html);
        var ti = document.getElementById('tc-title'); if (ti) ti.focus();
    }
    function inCss() { return 'width:100%;padding:7px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:12.5px;font-family:inherit;box-sizing:border-box;'; }
    function fld(label, inner, flex) { return '<div style="' + (flex ? 'flex:1;min-width:120px;' : '') + '"><div style="font-size:10.5px;font-weight:700;color:#475569;margin-bottom:3px;">' + label + '</div>' + inner + '</div>'; }

    function create() {
        var g = function (id) { var e = document.getElementById(id); return e ? e.value.trim() : ''; };
        var title = g('tc-title'); if (!title) { alert('Enter a title'); return; }
        var desc = g('tc-desc'), assignee = g('tc-assignee') || 'AI Digital Employee', cat = g('tc-category');
        var prio = parseInt(g('tc-prio') || '2', 10), date = g('tc-date') || state.date, recur = g('tc-recur') || 'ONCE';
        var trip = g('tc-trip') || date;
        // optional executable definition
        var stepsRaw = g('tc-steps'), completion = g('tc-completion'), actionJson = '';
        if (stepsRaw) {
            try { var o = JSON.parse(stepsRaw); if (!o.steps && Array.isArray(o)) o = { steps: o }; if (!Array.isArray(o.steps)) throw new Error('need a steps array'); actionJson = JSON.stringify({ steps: o.steps }); }
            catch (e) { alert('Executable steps are not valid JSON: ' + e.message); return; }
        }
        var r = ref();
        var sql = "INSERT INTO wms_ai_tasks (client_ref, title, description, assignee, category, priority, task_date, trip_date, recurrence, status, instance, created_by, created_date, action_json, completion_sql) VALUES (" +
            q(r) + ", " + q(title.slice(0, 300)) + ", " + clob(desc) + ", " + q(assignee.slice(0, 120)) + ", " + q(cat.slice(0, 60)) + ", " + prio + ", " +
            "TO_DATE(" + q(date) + ",'YYYY-MM-DD'), TO_DATE(" + q(trip) + ",'YYYY-MM-DD'), " + q(recur) + ", 'OPEN', " + q(inst()) + ", " + q(user()) + ", SYSDATE, " +
            (actionJson ? clob(actionJson) : 'NULL') + ", " + (completion ? clob(completion) : 'NULL') + ")";
        writeSql(sql, function (err) {
            if (err) { alert('Create failed: ' + err); return; }
            document.getElementById('tsk-create')?.remove();
            // fetch the new id via the client_ref, then log a CREATE event
            readSql("SELECT task_id FROM wms_ai_tasks WHERE client_ref = " + q(r), function (e2, rows) {
                if (rows && rows.length) logEvent(rows[0].TASK_ID, 'USER', 'CREATE', 'Task created and assigned to ' + assignee + (recur === 'DAILY' ? ' (repeats daily)' : ''), function () { load(); });
                else load();
            });
        });
    }

    // ── shared insert (used by manual create + the Assign wizard) ──
    function insertTaskDef(def, cb) {
        var title = String(def.title || '').slice(0, 300);
        if (!title) { cb && cb('missing title'); return; }
        var desc = def.description || '', assignee = String(def.assignee || 'AI Digital Employee').slice(0, 120);
        var cat = String(def.category || '').slice(0, 60), prio = parseInt(def.priority || 2, 10) || 2;
        var date = def.task_date || state.date, recur = (String(def.recurrence || 'ONCE').toUpperCase() === 'DAILY') ? 'DAILY' : 'ONCE';
        var trip = def.trip_date || def.tripDate || date;
        var steps = def.steps || (def.action && def.action.steps);
        var actionJson = (steps && steps.length) ? JSON.stringify({ steps: steps }) : '';
        var completion = def.completionSql || def.completion_sql || '';
        var r = ref();
        var sql = "INSERT INTO wms_ai_tasks (client_ref, title, description, assignee, category, priority, task_date, trip_date, recurrence, status, instance, created_by, created_date, action_json, completion_sql) VALUES (" +
            q(r) + ", " + q(title) + ", " + clob(desc) + ", " + q(assignee) + ", " + q(cat) + ", " + prio + ", TO_DATE(" + q(date) + ",'YYYY-MM-DD'), TO_DATE(" + q(trip) + ",'YYYY-MM-DD'), " + q(recur) + ", 'OPEN', " + q(inst()) + ", " + q(user()) + ", SYSDATE, " +
            (actionJson ? clob(actionJson) : 'NULL') + ", " + (completion ? clob(completion) : 'NULL') + ")";
        writeSql(sql, function (err) {
            if (err) { cb && cb(err); return; }
            readSql("SELECT task_id FROM wms_ai_tasks WHERE client_ref = " + q(r), function (e2, rows) {
                var id = rows && rows[0] && rows[0].TASK_ID;
                if (id) logEvent(id, 'USER', 'CREATE', 'Assigned to ' + assignee + (recur === 'DAILY' ? ' (repeats daily)' : ''), function () { cb && cb(null, id); });
                else cb && cb(null, null);
            });
        });
    }

    // ── Assign Tasks wizard (AI checks the warehouse & proposes tasks) ──
    var _suggest = [];
    function assignWizard() {
        document.getElementById('tsk-wiz')?.remove();
        var name = userName();
        document.body.insertAdjacentHTML('beforeend',
        '<div id="tsk-wiz" style="position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:1002;display:flex;align-items:center;justify-content:center;padding:16px;" onclick="if(event.target===this)this.remove()">' +
          '<div style="background:#fff;border-radius:16px;width:640px;max-width:96vw;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 24px 70px rgba(0,0,0,.35);overflow:hidden;">' +
            '<div style="padding:16px 20px;background:linear-gradient(135deg,#7c3aed,#0891b2);color:#fff;">' +
              '<div style="font-size:15px;font-weight:800;"><i class="fas fa-wand-magic-sparkles"></i> Assign Tasks' + (name ? ' for ' + esc2(name) : '') + '</div>' +
              '<div style="font-size:11.5px;opacity:.9;margin-top:2px;">I\'ll look at what needs doing and suggest tasks. Pick the ones to assign to me.</div>' +
            '</div>' +
            '<div id="tsk-wiz-body" style="flex:1;overflow-y:auto;padding:16px 20px;min-height:160px;"></div>' +
            '<div id="tsk-wiz-foot" style="padding:12px 20px;border-top:1px solid #eef2f7;display:flex;justify-content:space-between;align-items:center;gap:8px;">' +
              '<button onclick="Tasks.assignWizard()" style="border:1px solid #e2e8f0;background:#f8fafc;border-radius:8px;padding:7px 13px;font-size:12px;font-weight:700;cursor:pointer;color:#0e7490;"><i class="fas fa-rotate"></i> Re-analyze</button>' +
              '<div style="display:flex;gap:8px;">' +
                '<button onclick="document.getElementById(\'tsk-wiz\').remove()" style="border:1px solid #e2e8f0;background:#fff;border-radius:8px;padding:7px 14px;font-size:12px;font-weight:700;cursor:pointer;color:#64748b;">Close</button>' +
                '<button id="tsk-wiz-assign" onclick="Tasks.wizAssign()" disabled style="border:none;background:#cbd5e1;color:#fff;border-radius:8px;padding:7px 16px;font-size:12px;font-weight:800;cursor:not-allowed;"><i class="fas fa-check"></i> Assign selected</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>');
        wizAnalyze();
    }
    function wizAnalyze() {
        var body = document.getElementById('tsk-wiz-body'); if (!body) return;
        body.innerHTML = '<div style="text-align:center;color:#0e7490;font-size:13px;padding:26px 0;"><i class="fas fa-circle-notch fa-spin" style="font-size:20px;"></i><div style="margin-top:10px;">Checking the warehouse and preparing suggestions…</div><div style="font-size:10.5px;color:#94a3b8;margin-top:6px;">This can take a few seconds while I look at your data.</div></div>';
        var prompt =
            'You are the WMS AI Digital Assistant. Suggest a concise list of USEFUL tasks the user could assign to you today, based on the real warehouse state for instance ' + inst() + '. ' +
            'First look at what needs attention (query open trips, orders with Scheduled/Manual Reservation lines, orders ready to print/interface, anything overdue). ' +
            'Reply with ONLY a single ```json array (3 to 6 items), no prose: ' +
            '[{"title":"","description":"","category":"","priority":2,"recurrence":"ONCE","steps":[]}]. ' +
            'Keep titles short and action-oriented; include an executable steps array (query/rest/print/download_pdf/forEach/ipc, {VAR} placeholders, REAL ORDS URLs/columns) when you can, else leave steps empty.';
        var fallback = function (why) { _suggest = DEFAULT_SUGGESTIONS.slice(); wizRender(why + ' Here are common tasks you can assign:'); };
        if (typeof window.aiAsk !== 'function') { fallback('The assistant helper isn\'t available.'); return; }
        window.aiAsk(prompt, function (err, md) {
            if (err) { fallback('The assistant is busy or slow (' + esc2(String(err)) + ').'); return; }
            var arr = extractArray(md);
            if (!arr || !arr.length) { fallback('I couldn\'t build custom suggestions this time.'); return; }
            _suggest = arr;
            wizRender();
        });
    }
    function extractArray(md) {
        if (!md) return null;
        var m = md.match(/```json\s*([\s\S]*?)```/i) || md.match(/(\[[\s\S]*\])/);
        if (!m) return null;
        try { var a = JSON.parse(m[1]); return Array.isArray(a) ? a : (a.tasks || a.suggestions || null); } catch (e) { return null; }
    }
    function wizRender(note) {
        var body = document.getElementById('tsk-wiz-body'); if (!body) return;
        body.innerHTML = (note ? '<div style="font-size:11.5px;color:#b45309;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:7px 10px;margin-bottom:10px;">' + esc2(note) + '</div>' : '') +
            '<div style="font-size:11px;color:#64748b;margin-bottom:10px;">' + _suggest.length + ' suggested task(s) — tick the ones to assign, then <b>Assign selected</b>:</div>' +
            _suggest.map(function (d, i) {
                var p = PRIO[parseInt(d.priority || 2, 10)] || PRIO[2];
                var nSteps = (d.steps && d.steps.length) || 0;
                return '<label style="display:flex;gap:10px;align-items:flex-start;border:1px solid #e6eaf2;border-radius:10px;padding:10px 12px;margin-bottom:8px;cursor:pointer;">' +
                    '<input type="checkbox" class="tsk-wiz-cb" data-i="' + i + '" checked onchange="Tasks._wizToggle()" style="margin-top:3px;width:15px;height:15px;accent-color:#7c3aed;">' +
                    '<div style="flex:1;min-width:0;">' +
                      '<div style="display:flex;align-items:center;gap:7px;"><span style="width:8px;height:8px;border-radius:50%;background:' + p[1] + ';"></span>' +
                        '<span style="font-size:13px;font-weight:700;color:#0f172a;">' + esc2(d.title || 'Untitled') + '</span></div>' +
                      (d.description ? '<div style="font-size:11.5px;color:#64748b;margin-top:3px;line-height:1.45;">' + esc2(String(d.description).slice(0, 200)) + '</div>' : '') +
                      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:5px;font-size:9.5px;color:#64748b;">' +
                        (d.category ? '<span style="background:#eef2ff;color:#4338ca;border-radius:6px;padding:1px 6px;">' + esc2(d.category) + '</span>' : '') +
                        '<span>' + p[0] + ' priority</span>' +
                        (String(d.recurrence || '').toUpperCase() === 'DAILY' ? '<span style="color:#7c3aed;"><i class="fas fa-repeat"></i> daily</span>' : '') +
                        (nSteps ? '<span style="color:#0e7490;"><i class="fas fa-bolt"></i> ' + nSteps + ' step(s) — runnable</span>' : '<span style="color:#94a3b8;">no steps (you can run with AI)</span>') +
                      '</div>' +
                    '</div></label>';
            }).join('');
        _wizToggle();
    }
    function _wizToggle() {
        var any = document.querySelectorAll('.tsk-wiz-cb:checked').length;
        var btn = document.getElementById('tsk-wiz-assign'); if (!btn) return;
        btn.disabled = !any;
        btn.style.background = any ? '#7c3aed' : '#cbd5e1';
        btn.style.cursor = any ? 'pointer' : 'not-allowed';
        btn.innerHTML = '<i class="fas fa-check"></i> Assign selected' + (any ? ' (' + any + ')' : '');
    }
    function wizAssign() {
        var boxes = Array.prototype.slice.call(document.querySelectorAll('.tsk-wiz-cb:checked'));
        var defs = boxes.map(function (b) { return _suggest[parseInt(b.getAttribute('data-i'), 10)]; }).filter(Boolean);
        if (!defs.length) return;
        var btn = document.getElementById('tsk-wiz-assign'); if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Assigning…'; }
        var i = 0;
        (function next() {
            if (i >= defs.length) { document.getElementById('tsk-wiz')?.remove(); load(); return; }
            insertTaskDef(defs[i], function () { i++; next(); });
        })();
    }

    // ── edit / modify a task ────────────────────────────────
    function openEdit(id) {
        var t = _openTask; if (!t || t.TASK_ID != id) { open(id); setTimeout(function () { openEdit(id); }, 250); return; }
        document.getElementById('tsk-edit')?.remove();
        var stepsVal = '';
        var st = parseSteps(t.ACTION_JSON); if (st && st.length) stepsVal = JSON.stringify({ steps: st }, null, 2);
        var recur = (String(t.RECURRENCE || 'ONCE').toUpperCase() === 'DAILY') ? 'DAILY' : 'ONCE';
        var prio = String(t.PRIORITY || 2);
        document.body.insertAdjacentHTML('beforeend',
        '<div id="tsk-edit" style="position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:1003;display:flex;align-items:center;justify-content:center;padding:16px;" onclick="if(event.target===this)this.remove()">' +
          '<div style="background:#fff;border-radius:14px;width:520px;max-width:96vw;max-height:90vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.3);">' +
            '<div style="padding:14px 18px;border-bottom:1px solid #eef2f7;font-size:15px;font-weight:800;color:#0f172a;"><i class="fas fa-pen" style="color:#7c3aed;"></i> Edit Task #' + t.TASK_ID + '</div>' +
            '<div style="padding:16px 18px;display:flex;flex-direction:column;gap:10px;">' +
              fld('Title', '<input id="te-title" style="' + inCss() + '" value="' + esc2(t.TITLE || '') + '">') +
              fld('Details / instructions', '<textarea id="te-desc" style="' + inCss() + 'min-height:80px;resize:vertical;">' + esc2(t.DESCRIPTION || '') + '</textarea>') +
              '<div style="display:flex;gap:10px;flex-wrap:wrap;">' +
                fld('Assignee', '<input id="te-assignee" value="' + esc2(t.ASSIGNEE || 'AI Digital Employee') + '" style="' + inCss() + '">', 1) +
                fld('Category', '<input id="te-category" value="' + esc2(t.CATEGORY || '') + '" style="' + inCss() + '">', 1) +
              '</div>' +
              '<div style="display:flex;gap:10px;flex-wrap:wrap;">' +
                fld('Priority', '<select id="te-prio" style="' + inCss() + '"><option value="1"' + (prio === '1' ? ' selected' : '') + '>High</option><option value="2"' + (prio === '2' ? ' selected' : '') + '>Medium</option><option value="3"' + (prio === '3' ? ' selected' : '') + '>Low</option></select>', 1) +
                fld('List date', '<input id="te-date" type="date" value="' + esc2(t.TASK_DATE || state.date) + '" style="' + inCss() + '">', 1) +
                fld('Repeat', '<select id="te-recur" style="' + inCss() + '"><option value="ONCE"' + (recur === 'ONCE' ? ' selected' : '') + '>Once</option><option value="DAILY"' + (recur === 'DAILY' ? ' selected' : '') + '>Daily</option></select>', 1) +
              '</div>' +
              '<div style="background:#ecfeff;border:1px solid #cffafe;border-radius:10px;padding:9px 11px;">' +
                fld('<i class="fas fa-truck" style="color:#0e7490;"></i> Trip date — the AI works ONLY on this trip date', '<input id="te-trip" type="date" value="' + esc2(t.TRIP_DATE || t.TASK_DATE || state.date) + '" style="' + inCss() + '">') +
              '</div>' +
              '<details' + (stepsVal ? ' open' : '') + '><summary style="font-size:11px;font-weight:700;color:#0e7490;cursor:pointer;"><i class="fas fa-bolt"></i> Executable steps (JSON) &amp; completion</summary>' +
                '<div style="margin-top:8px;display:flex;flex-direction:column;gap:8px;">' +
                  fld('Steps (JSON)', '<textarea id="te-steps" style="' + inCss() + 'min-height:90px;font-family:Consolas,monospace;font-size:11px;resize:vertical;">' + esc2(stepsVal) + '</textarea>') +
                  fld('Completion SQL (optional)', '<input id="te-completion" value="' + esc2(t.COMPLETION_SQL || '') + '" style="' + inCss() + '">') +
                '</div>' +
              '</details>' +
            '</div>' +
            '<div style="padding:12px 18px;border-top:1px solid #eef2f7;display:flex;justify-content:flex-end;gap:8px;">' +
              '<button onclick="document.getElementById(\'tsk-edit\').remove()" style="border:1px solid #e2e8f0;background:#fff;border-radius:8px;padding:7px 14px;font-size:12px;font-weight:700;cursor:pointer;color:#64748b;">Cancel</button>' +
              '<button onclick="Tasks.saveEdit(' + t.TASK_ID + ')" style="border:none;background:#7c3aed;color:#fff;border-radius:8px;padding:7px 16px;font-size:12px;font-weight:800;cursor:pointer;">Save changes</button>' +
            '</div>' +
          '</div>' +
        '</div>');
    }
    function saveEdit(id) {
        var g = function (x) { var e = document.getElementById(x); return e ? e.value.trim() : ''; };
        var title = g('te-title'); if (!title) { alert('Title cannot be empty'); return; }
        var stepsRaw = g('te-steps'), actionJson = null;
        if (stepsRaw) {
            try { var o = JSON.parse(stepsRaw); if (!o.steps && Array.isArray(o)) o = { steps: o }; if (!Array.isArray(o.steps)) throw new Error('need a steps array'); actionJson = JSON.stringify({ steps: o.steps }); }
            catch (e) { alert('Executable steps are not valid JSON: ' + e.message); return; }
        }
        var completion = g('te-completion');
        var sets = [
            'title = ' + q(title.slice(0, 300)),
            'description = ' + clob(g('te-desc')),
            'assignee = ' + q((g('te-assignee') || 'AI Digital Employee').slice(0, 120)),
            'category = ' + q(g('te-category').slice(0, 60)),
            'priority = ' + (parseInt(g('te-prio') || '2', 10) || 2),
            "task_date = TO_DATE(" + q(g('te-date') || state.date) + ",'YYYY-MM-DD')",
            "trip_date = TO_DATE(" + q(g('te-trip') || g('te-date') || state.date) + ",'YYYY-MM-DD')",
            'recurrence = ' + q(g('te-recur') || 'ONCE'),
            'action_json = ' + (actionJson ? clob(actionJson) : 'NULL'),
            'completion_sql = ' + (completion ? clob(completion) : 'NULL'),
            'updated_by = ' + q(user()), 'updated_date = SYSDATE'
        ];
        writeSql('UPDATE wms_ai_tasks SET ' + sets.join(', ') + ' WHERE task_id = ' + parseInt(id, 10), function (err) {
            if (err) { alert('Save failed: ' + err); return; }
            document.getElementById('tsk-edit')?.remove();
            logEvent(id, 'USER', 'NOTE', 'Task edited', function () { open(id); load(); });
        });
    }

    // ── Task Library (pick common WMS tasks to assign) ──────
    function openLibrary() {
        document.getElementById('tsk-lib')?.remove();
        var cats = {};
        TASK_LIBRARY.forEach(function (t, i) { (cats[t.category] = cats[t.category] || []).push(i); });
        var bodyHtml = Object.keys(cats).map(function (c) {
            return '<div style="font-size:10px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin:12px 2px 6px;">' + esc2(c) + '</div>' +
                cats[c].map(function (i) {
                    var t = TASK_LIBRARY[i], p = PRIO[t.priority] || PRIO[2];
                    return '<div id="lib-row-' + i + '" style="display:flex;gap:10px;align-items:flex-start;border:1px solid #e6eaf2;border-radius:10px;padding:9px 11px;margin-bottom:7px;">' +
                        '<span style="width:8px;height:8px;border-radius:50%;background:' + p[1] + ';margin-top:4px;flex-shrink:0;"></span>' +
                        '<div style="flex:1;min-width:0;"><div style="font-size:12.5px;font-weight:700;color:#0f172a;">' + esc2(t.title) + '</div>' +
                          '<div style="font-size:11px;color:#64748b;margin-top:2px;line-height:1.45;">' + esc2(t.description) + '</div>' +
                          '<div style="font-size:9.5px;color:#94a3b8;margin-top:3px;">' + p[0] + ' priority' + (t.recurrence === 'DAILY' ? ' · daily' : '') + '</div></div>' +
                        '<button id="lib-btn-' + i + '" onclick="Tasks.assignFromLib(' + i + ')" style="border:none;background:#7c3aed;color:#fff;border-radius:8px;padding:6px 12px;font-size:11px;font-weight:800;cursor:pointer;white-space:nowrap;align-self:center;"><i class="fas fa-plus"></i> Assign</button>' +
                    '</div>';
                }).join('');
        }).join('');
        document.body.insertAdjacentHTML('beforeend',
        '<div id="tsk-lib" style="position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:1002;display:flex;align-items:center;justify-content:center;padding:16px;" onclick="if(event.target===this)this.remove()">' +
          '<div style="background:#fff;border-radius:16px;width:660px;max-width:96vw;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 24px 70px rgba(0,0,0,.35);overflow:hidden;">' +
            '<div style="padding:16px 20px;background:linear-gradient(135deg,#7c3aed,#0891b2);color:#fff;">' +
              '<div style="font-size:15px;font-weight:800;"><i class="fas fa-book-open"></i> Task Library</div>' +
              '<div style="font-size:11.5px;opacity:.9;margin-top:2px;">Common tasks the WMS does — pick any to assign to your AI Digital Employee.</div>' +
            '</div>' +
            '<div style="flex:1;overflow-y:auto;padding:8px 20px 16px;">' + bodyHtml + '</div>' +
            '<div style="padding:12px 20px;border-top:1px solid #eef2f7;text-align:right;">' +
              '<button onclick="document.getElementById(\'tsk-lib\').remove()" style="border:1px solid #e2e8f0;background:#fff;border-radius:8px;padding:7px 16px;font-size:12px;font-weight:700;cursor:pointer;color:#64748b;">Done</button>' +
            '</div>' +
          '</div>' +
        '</div>');
    }
    function assignFromLib(i) {
        var t = TASK_LIBRARY[i]; if (!t) return;
        var btn = document.getElementById('lib-btn-' + i);
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i>'; }
        insertTaskDef({ title: t.title, description: t.description, category: t.category, priority: t.priority, recurrence: t.recurrence, steps: t.steps || [] }, function (err) {
            if (btn) {
                if (err) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-plus"></i> Assign'; alert('Assign failed: ' + err); return; }
                btn.style.background = '#16a34a'; btn.innerHTML = '<i class="fas fa-check"></i> Assigned';
            }
            load();
        });
    }

    window.Tasks = {
        load: load,
        refresh: load,
        openLibrary: openLibrary,
        assignFromLib: assignFromLib,
        assignWizard: assignWizard,
        wizAssign: wizAssign,
        _wizToggle: _wizToggle,
        setDate: function (d) { state.date = d || todayStr(); var el = document.getElementById('tsk-date'); if (el) el.value = state.date; load(); },
        search: function (v) { state.search = v || ''; renderBoard(null); },
        open: open,
        openCreate: openCreate,
        create: create,
        setStatus: setStatus,
        addEvent: addEvent,
        runAI: runAI,
        execute: execute,
        buildWithAI: buildWithAI,
        openEdit: openEdit,
        saveEdit: saveEdit
    };
})();
