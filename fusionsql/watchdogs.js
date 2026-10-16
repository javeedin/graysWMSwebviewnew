/* ═══════════════════════════════════════════════════════════════
   Fusion SQL — Watchdogs ("tell me when something is unusual")

   WMS_FUSION_WATCHDOGS   one row per watchdog: query, pod, how to read a number from it
                          (row count or a value column), the rule (AUTO = learn what is normal,
                          ABOVE / BELOW a limit, CHANGE %), schedule, alert settings, last state
   WMS_FUSION_WATCH_RUNS  every run: value, expected range, status, message
   WMS_FUSION_WATCH_LEASE one row: which PC runs the schedule right now
   (apex_sql/80_fusion_knowledge_watchdogs.sql — auto-created)

   The schedule runs on any PC with Fusion SQL open on the watchdog's pod; a 3-minute lease in
   APEX makes sure only one PC runs it. Alerts go to Teams / e-mail through the host action
   fusionSqlWatchAlert (AI Control alert settings, or the watchdog's own webhook / e-mail list).
   watch-engine.js decides OK / ALERT / LEARNING.
   ═══════════════════════════════════════════════════════════════ */

var WD = {
    state: 'idle', error: null,
    list: [], spark: {},                 // spark: watch_id -> [{t, v}]
    running: {},                         // watch_id -> true
    lease: { holder: null, mine: false, until: null },
    timer: null, ticking: false,
    session: 'S' + Math.random().toString(36).slice(2, 8)
};
var WD_T = 'wms_fusion_watchdogs', WD_RUNS = 'wms_fusion_watch_runs', WD_LEASE = 'wms_fusion_watch_lease';
var WD_DDL = {
    WMS_FUSION_WATCHDOGS: ['CREATE TABLE wms_fusion_watchdogs (watch_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, watch_name VARCHAR2(200) NOT NULL, ' +
        "description VARCHAR2(1000), sql_text CLOB NOT NULL, instance VARCHAR2(10) DEFAULT 'PROD', metric VARCHAR2(10) DEFAULT 'ROWS', value_column VARCHAR2(128), " +
        "unit_label VARCHAR2(40), rule_type VARCHAR2(10) DEFAULT 'AUTO', threshold NUMBER, direction VARCHAR2(5) DEFAULT 'BOTH', sensitivity VARCHAR2(10) DEFAULT 'MEDIUM', " +
        "every_min NUMBER DEFAULT 60, active VARCHAR2(1) DEFAULT 'Y', notify VARCHAR2(1) DEFAULT 'Y', teams_webhook VARCHAR2(1000), email_to VARCHAR2(1000), " +
        "cooldown_hours NUMBER DEFAULT 6, status VARCHAR2(10) DEFAULT 'NEW', last_value NUMBER, last_message VARCHAR2(1000), last_run DATE, next_run DATE, last_alert DATE, " +
        'run_count NUMBER DEFAULT 0, alert_count NUMBER DEFAULT 0, created_by VARCHAR2(120), created_date DATE DEFAULT SYSDATE, changed_by VARCHAR2(120), changed_date DATE)'],
    WMS_FUSION_WATCH_RUNS: ['CREATE TABLE wms_fusion_watch_runs (run_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, watch_id NUMBER NOT NULL, run_date DATE, ' +
        "metric_value NUMBER, expected NUMBER, low_value NUMBER, high_value NUMBER, status VARCHAR2(10), message VARCHAR2(1000), elapsed_ms NUMBER, notified VARCHAR2(1) DEFAULT 'N', " +
        'run_by VARCHAR2(120))', 'CREATE INDEX wms_fusion_watch_runs_ix ON wms_fusion_watch_runs (watch_id, run_date)'],
    WMS_FUSION_WATCH_LEASE: ['CREATE TABLE wms_fusion_watch_lease (lease_name VARCHAR2(30) PRIMARY KEY, holder VARCHAR2(200), lease_until DATE)']
};
var WD_EVERY = [[15, 'every 15 min'], [30, 'every 30 min'], [60, 'every hour'], [120, 'every 2 hours'], [240, 'every 4 hours'], [720, 'twice a day'], [1440, 'once a day']];

// Times are written as the PC's local time, so "Tuesdays around 09:00" means 09:00 where the users are
function wdLocalIso(ms) {
    var d = new Date(ms), p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}
function wdDate(ms) { return ms ? "TO_DATE('" + wdLocalIso(ms) + "', 'YYYY-MM-DD HH24:MI:SS')" : 'NULL'; }
function wdParse(s) { if (!s) return null; var m = /^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d):?(\d\d)?/.exec(s); return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime() : null; }
function wdNum(v) { return v == null || v === '' || !isFinite(v) ? 'NULL' : String(+v); }
function wdMe() { return (appUserName() + ' · ' + WD.session).slice(0, 200); }
function wdAgo(ms) {
    if (!ms) return 'never';
    var d = Math.round((Date.now() - ms) / 60000);
    if (d < 1) return 'just now'; if (d < 60) return d + ' min ago'; if (d < 1440) return Math.round(d / 60) + ' h ago'; return Math.round(d / 1440) + ' d ago';
}
function wdIn(ms) {
    if (!ms) return '—';
    var d = Math.round((ms - Date.now()) / 60000);
    if (d <= 0) return 'due now'; if (d < 60) return 'in ' + d + ' min'; if (d < 1440) return 'in ' + Math.round(d / 60) + ' h'; return 'in ' + Math.round(d / 1440) + ' d';
}

// ── Tables & loading ──────────────────────────────────────────
function wdEnsure() {
    if (WD._ensured) return WD._ensured;
    WD._ensured = dbRead("SELECT table_name FROM user_tables WHERE table_name IN ('WMS_FUSION_WATCHDOGS','WMS_FUSION_WATCH_RUNS','WMS_FUSION_WATCH_LEASE')", 5).then(function (r) {
        var have = {}; r.forEach(function (x) { have[x.TABLE_NAME] = 1; });
        var todo = [];
        Object.keys(WD_DDL).forEach(function (t) { if (!have[t]) todo = todo.concat(WD_DDL[t]); });
        return todo.reduce(function (p, d) { return p.then(function () { return dbWrite(d); }); }, Promise.resolve());
    }).catch(function (e) { WD._ensured = null; throw e; });
    return WD._ensured;
}
function wdLoad() {
    WD.state = WD.list.length ? 'ready' : 'loading'; wdRender();
    var pieces = [];
    for (var i = 0; i < SQL_PIECES; i++) pieces.push('TO_CHAR(SUBSTR(sql_text, ' + (i * SQL_PIECE + 1) + ', ' + SQL_PIECE + ')) AS p' + i);
    return wdEnsure().then(function () {
        return Promise.all([
            dbRead('SELECT watch_id, watch_name, description, instance, metric, value_column, unit_label, rule_type, threshold, direction, sensitivity, every_min, active, notify, ' +
                'teams_webhook, email_to, cooldown_hours, status, last_value, last_message, run_count, alert_count, created_by, ' +
                "TO_CHAR(last_run, 'YYYY-MM-DD HH24:MI:SS') AS last_run_at, TO_CHAR(next_run, 'YYYY-MM-DD HH24:MI:SS') AS next_run_at, " +
                "TO_CHAR(last_alert, 'YYYY-MM-DD HH24:MI:SS') AS last_alert_at, " + pieces.join(', ') + ' FROM ' + WD_T + ' ORDER BY watch_name', 500),
            dbRead('SELECT watch_id, metric_value, low_value, high_value, status, ' + "TO_CHAR(run_date, 'YYYY-MM-DD HH24:MI:SS') AS run_at FROM " + WD_RUNS +
                " WHERE run_date > SYSDATE - 21 AND status IN ('OK','ALERT','LEARNING') ORDER BY run_date", 5000)
        ]);
    }).then(function (res) {
        WD.list = res[0].map(function (r) {
            var sql = ''; for (var i = 0; i < SQL_PIECES; i++) sql += r['P' + i] || '';
            return {
                id: r.WATCH_ID, name: r.WATCH_NAME, description: r.DESCRIPTION || '', sql: sql, instance: r.INSTANCE || 'PROD',
                metric: r.METRIC || 'ROWS', column: r.VALUE_COLUMN || '', unit: r.UNIT_LABEL || (r.METRIC === 'VALUE' ? '' : 'rows'),
                rule: r.RULE_TYPE || 'AUTO', threshold: r.THRESHOLD, direction: r.DIRECTION || 'BOTH', sensitivity: r.SENSITIVITY || 'MEDIUM',
                every: +r.EVERY_MIN || 60, active: r.ACTIVE !== 'N', notify: r.NOTIFY !== 'N', hook: r.TEAMS_WEBHOOK || '', email: r.EMAIL_TO || '',
                cooldown: r.COOLDOWN_HOURS == null ? 6 : +r.COOLDOWN_HOURS, status: r.STATUS || 'NEW', value: r.LAST_VALUE, message: r.LAST_MESSAGE || '',
                runs: +r.RUN_COUNT || 0, alerts: +r.ALERT_COUNT || 0, by: r.CREATED_BY || '',
                lastRun: wdParse(r.LAST_RUN_AT), nextRun: wdParse(r.NEXT_RUN_AT), lastAlert: wdParse(r.LAST_ALERT_AT)
            };
        });
        WD.spark = {};
        res[1].forEach(function (r) {
            (WD.spark[r.WATCH_ID] = WD.spark[r.WATCH_ID] || []).push({ t: wdParse(r.RUN_AT), v: +r.METRIC_VALUE, lo: r.LOW_VALUE, hi: r.HIGH_VALUE, s: r.STATUS });
        });
        WD.state = 'ready'; WD.error = null;
    }).catch(function (e) { WD.state = 'error'; WD.error = String(e); })
      .then(function () { wdRender(); return WD.list; });
}
function wdFind(id) { return WD.list.filter(function (w) { return String(w.id) === String(id); })[0]; }

// ── Running one watchdog ──────────────────────────────────────
/** History of successful runs [{t, v}] for the baseline (last 200). */
function wdHistory(id) {
    return dbRead('SELECT metric_value, ' + "TO_CHAR(run_date, 'YYYY-MM-DD HH24:MI:SS') AS run_at FROM " + WD_RUNS + ' WHERE watch_id = ' + (+id) +
        " AND status IN ('OK','ALERT','LEARNING') AND metric_value IS NOT NULL ORDER BY run_date DESC FETCH FIRST 200 ROWS ONLY", 200)
        .then(function (rows) { return rows.map(function (r) { return { t: wdParse(r.RUN_AT), v: +r.METRIC_VALUE }; }).filter(function (x) { return x.t && isFinite(x.v); }); });
}
function wdRun(id, manual) {
    var w = wdFind(id); if (!w || WD.running[id]) return Promise.resolve();
    if (w.instance !== currentInstance()) {
        if (manual) toast('"' + w.name + '" watches ' + w.instance + ' — switch Fusion SQL to ' + w.instance + ' to run it', 'warn');
        return Promise.resolve();
    }
    WD.running[id] = true; wdRender();
    var now = Date.now(), t0 = Date.now(), value = NaN, ev = null, err = null;
    return fsCall('fusionSqlExecute', { sql: WD_ENGINE.metricSql(w.sql, w.metric, w.column), rowLimit: w.metric === 'ROWS' ? 1 : 5, instance: w.instance })
        .then(function (r) {
            if (!r || !r.success) throw (r && r.error) || 'Query failed';
            value = WD_ENGINE.metricValue(r, w.metric, w.column);
            if (!isFinite(value)) throw 'The query returned no number' + (w.column ? ' in column ' + w.column : '');
            return wdHistory(id);
        })
        .then(function (hist) {
            ev = WD_ENGINE.evaluate(hist, value, now, { rule: w.rule, threshold: w.threshold, direction: w.direction, sensitivity: w.sensitivity, unit: w.unit || (w.metric === 'ROWS' ? 'rows' : '') });
        })
        .catch(function (e) { err = String(e).split('\n')[0].slice(0, 900); })
        .then(function () {
            var status = err ? 'ERROR' : ev.status, msg = err ? 'Error: ' + err : ev.message;
            var notify = !err && w.active && w.notify && WD_ENGINE.shouldNotify(w.status, status, w.lastAlert, now, w.cooldown);
            var next = WD_ENGINE.nextRun(now, w.every);
            var writes = [
                'INSERT INTO ' + WD_RUNS + ' (watch_id, run_date, metric_value, expected, low_value, high_value, status, message, elapsed_ms, notified, run_by) VALUES (' +
                (+id) + ', ' + wdDate(now) + ', ' + wdNum(err ? null : value) + ', ' + wdNum(ev && ev.expected) + ', ' + wdNum(ev && isFinite(ev.low) ? ev.low : null) + ', ' +
                wdNum(ev && isFinite(ev.high) ? ev.high : null) + ', ' + lit(status) + ', ' + vlit(msg, 1000) + ', ' + (Date.now() - t0) + ', ' + lit(notify ? 'Y' : 'N') + ', ' + vlit(wdMe(), 120) + ')',
                'UPDATE ' + WD_T + ' SET status = ' + lit(status) + ', last_value = ' + wdNum(err ? w.value : value) + ', last_message = ' + vlit(msg, 1000) +
                ', last_run = ' + wdDate(now) + ', next_run = ' + wdDate(next) + ', run_count = NVL(run_count, 0) + 1' +
                (status === 'ALERT' && w.status !== 'ALERT' ? ', alert_count = NVL(alert_count, 0) + 1' : '') +
                (notify ? ', last_alert = ' + wdDate(now) : '') + ' WHERE watch_id = ' + (+id)
            ];
            return writes.reduce(function (p, s) { return p.then(function () { return dbWrite(s); }); }, Promise.resolve())
                .then(function () {
                    var was = w.status;
                    w.status = status; w.message = msg; w.lastRun = now; w.nextRun = next; w.runs++;
                    if (!err) { w.value = value; (WD.spark[id] = WD.spark[id] || []).push({ t: now, v: value, lo: ev.low, hi: ev.high, s: status }); }
                    if (status === 'ALERT' && was !== 'ALERT') w.alerts++;
                    if (status === 'ALERT') toast('🔔 ' + w.name + ': ' + msg, 'warn');
                    else if (manual) toast(w.name + ': ' + msg, err ? 'err' : 'ok');
                    if (notify) { w.lastAlert = now; return wdAlert(w, msg); }
                });
        })
        .catch(function (e) { if (manual) toast('Could not save the run: ' + e, 'err'); })
        .then(function () { delete WD.running[id]; wdRender(); });
}
function wdAlert(w, msg) {
    var text = '🔔 Fusion SQL watchdog "' + w.name + '" (' + w.instance + ')\n\n' + msg +
        (w.description ? '\n\n' + w.description : '') + '\n\nOpen Gray\'s WMS › Fusion SQL › Watchdogs to see the history and the data.';
    return fsCall('fusionSqlWatchAlert', { subject: 'Watchdog alert: ' + w.name, text: text, teamsWebhook: w.hook || '', emailTo: w.email || '' })
        .then(function (r) { if (r && r.ok === false) toast('Alert not sent: ' + r.error, 'err'); })
        .catch(function (e) { toast('Alert not sent: ' + e, 'err'); });
}

// ── Schedule (one PC at a time) ───────────────────────────────
/** Takes or renews the 3-minute lease; resolves true when this page holds it. */
function wdLease() {
    var me = wdMe();
    return dbWrite('MERGE INTO ' + WD_LEASE + " t USING (SELECT 'WATCHDOGS' AS lease_name FROM dual) s ON (t.lease_name = s.lease_name) " +
        'WHEN MATCHED THEN UPDATE SET t.holder = ' + vlit(me, 200) + ', t.lease_until = SYSDATE + 3/1440 WHERE t.lease_until < SYSDATE OR t.holder = ' + vlit(me, 200) + ' ' +
        'WHEN NOT MATCHED THEN INSERT (lease_name, holder, lease_until) VALUES (s.lease_name, ' + vlit(me, 200) + ', SYSDATE + 3/1440)')
        .then(function () { return dbRead("SELECT holder, TO_CHAR(lease_until, 'YYYY-MM-DD HH24:MI:SS') AS until_at, CASE WHEN lease_until > SYSDATE THEN 1 ELSE 0 END AS live FROM " + WD_LEASE + " WHERE lease_name = 'WATCHDOGS'", 1); })
        .then(function (r) {
            WD.lease.holder = r[0] ? r[0].HOLDER : null;
            WD.lease.mine = !!(r[0] && r[0].HOLDER === me && +r[0].LIVE === 1);
            return WD.lease.mine;
        });
}
function wdTick() {
    if (WD.ticking) return;
    var due = WD.list.filter(function (w) { return w.active && w.instance === currentInstance() && (!w.nextRun || w.nextRun <= Date.now()); });
    WD.ticking = true;
    var p = WD.list.length ? wdLease() : Promise.resolve(false);
    p.then(function (mine) {
        if (!mine || !due.length) return;
        return due.reduce(function (q, w) { return q.then(function () { return wdRun(w.id, false); }); }, Promise.resolve());
    }).catch(function () { })
      .then(function () { WD.ticking = false; wdRenderRunner(); });
}
/** Starts the schedule when Fusion SQL opens: reload the list every 5 min, check due watchdogs every minute. */
function wdStart() {
    if (WD.timer) return;
    var reloadEvery = 5, n = 0;
    var go = function () {
        var p = (n++ % reloadEvery === 0 || !WD.list.length) ? wdLoad() : Promise.resolve();
        p.then(wdTick);
    };
    setTimeout(go, 8000);                 // let the page finish loading first
    WD.timer = setInterval(go, 60000);
}

// ── Create / edit ─────────────────────────────────────────────
/** "Watch this" in the SQL Builder grid: the query that produced the result, with its parameter values filled in. */
function wdFromBuilder() {
    var src = FS.result && FS.result.source;
    var sql = src && src.sql ? (src.params && Object.keys(src.params).length ? substituteParams(src.sql, src.params) : src.sql) : (FS.result && FS.result.sql) || getRunSql();
    if (!sql || !sql.trim()) { toast('Run a query first', 'warn'); return; }
    var cols = FS.result ? FS.result.columns : [];
    if (src && src.params && Object.keys(src.params).length) toast('The parameter values you ran with are fixed in the watchdog — use SYSDATE in the query for a moving date', 'warn');
    wdEdit(null, { sql: sql, name: FS.currentQuery ? FS.currentQuery.name : '', columns: cols });
}
/** "Watch" on a saved query. */
function wdFromQuery(i) {
    var q = FS.queries[i]; if (!q) return;
    var params = detectParams(q.sql);
    var go = function (sql) { wdEdit(null, { sql: sql, name: q.name, description: q.description }); };
    if (params.length) askParams(params, q.sql).then(function (vals) { if (vals) go(substituteParams(q.sql, vals)); });
    else go(q.sql);
}
function wdEdit(id, seed) {
    var w = id ? wdFind(id) : Object.assign({ name: '', description: '', sql: '', instance: currentInstance(), metric: 'ROWS', column: '', unit: '', rule: 'AUTO', threshold: '',
        direction: 'UP', sensitivity: 'MEDIUM', every: 60, active: true, notify: true, hook: '', email: '', cooldown: 6 }, seed || {});
    if (!w) return;
    if (detectParams(w.sql).length) { toast('A watchdog query cannot ask for parameters — fill in the values first', 'warn'); }
    var cols = (seed && seed.columns) || [];
    var opt = function (v, l, cur) { return '<option value="' + v + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + l + '</option>'; };
    openModal(id ? 'Edit watchdog' : 'New watchdog', '<div class="kb-form wd-form">' +
        '<div class="kb-2"><label>Name<input id="wd-f-name" value="' + esc(w.name) + '" placeholder="Orders stuck in Awaiting Shipping"></label>' +
        '<label>Pod<select id="wd-f-inst">' + opt('PROD', 'PROD', w.instance) + opt('TEST', 'TEST', w.instance) + '</select></label></div>' +
        '<label>What to watch <span class="fs-muted">(read-only query on Fusion; no {{parameters}} — use SYSDATE for moving dates)</span><textarea id="wd-f-sql" rows="6" class="kb-mono">' + esc(w.sql) + '</textarea></label>' +
        '<div id="wd-f-test" class="wd-test"></div>' +
        '<div class="kb-2"><label>The number<select id="wd-f-metric" onchange="wdFormSync()">' + opt('ROWS', 'Number of rows the query returns', w.metric) + opt('VALUE', 'A value from the first row', w.metric) + '</select></label>' +
        '<label id="wd-f-col-wrap">Column<input id="wd-f-col" list="wd-f-cols" value="' + esc(w.column) + '" placeholder="TOTAL_AMOUNT"><datalist id="wd-f-cols">' + cols.map(function (c) { return '<option value="' + esc(c) + '">'; }).join('') + '</datalist></label></div>' +
        '<label>Unit <span class="fs-muted">(shown in alerts: orders, lines, MUR …)</span><input id="wd-f-unit" value="' + esc(w.unit) + '" placeholder="orders"></label>' +
        '<div class="wd-rule"><label>Alert when<select id="wd-f-rule" onchange="wdFormSync()">' +
        opt('AUTO', '✨ It is unusual (learns what is normal)', w.rule) + opt('ABOVE', 'It goes above a limit', w.rule) + opt('BELOW', 'It falls below a limit', w.rule) + opt('CHANGE', 'It changes by more than n % since the last run', w.rule) + '</select></label>' +
        '<label id="wd-f-thr-wrap">Limit<input id="wd-f-thr" type="number" step="any" value="' + esc(w.threshold == null ? '' : w.threshold) + '"></label>' +
        '<label id="wd-f-dir-wrap">Direction<select id="wd-f-dir">' + opt('UP', 'Only when higher', w.direction) + opt('DOWN', 'Only when lower', w.direction) + opt('BOTH', 'Higher or lower', w.direction) + '</select></label>' +
        '<label id="wd-f-sens-wrap">Sensitivity<select id="wd-f-sens">' + opt('LOW', 'Low — only big surprises', w.sensitivity) + opt('MEDIUM', 'Medium', w.sensitivity) + opt('HIGH', 'High — small changes too', w.sensitivity) + '</select></label></div>' +
        '<p class="fs-muted wd-hint" id="wd-f-hint"></p>' +
        '<div class="kb-2"><label>Check<select id="wd-f-every">' + WD_EVERY.map(function (e) { return opt(e[0], e[1], w.every); }).join('') + '</select></label>' +
        '<label>Repeat an ongoing alert after<select id="wd-f-cd">' + opt(1, '1 hour', w.cooldown) + opt(6, '6 hours', w.cooldown) + opt(24, '1 day', w.cooldown) + opt(9999, 'never (only when it starts)', w.cooldown) + '</select></label></div>' +
        '<label class="kb-check"><input type="checkbox" id="wd-f-notify"' + (w.notify ? ' checked' : '') + '> Send alerts to Teams / e-mail</label>' +
        '<div class="kb-2"><label>Teams webhook <span class="fs-muted">(blank = AI Control alert setting)</span><input id="wd-f-hook" value="' + esc(w.hook) + '" placeholder="https://….webhook.office.com/…"></label>' +
        '<label>E-mail to <span class="fs-muted">(blank = AI Control setting)</span><input id="wd-f-email" value="' + esc(w.email) + '" placeholder="ops@company.com; manager@company.com"></label></div>' +
        '<label>Note for the alert <span class="fs-muted">(what to do when it fires)</span><input id="wd-f-desc" value="' + esc(w.description) + '" placeholder="Check pick release for these orders"></label>' +
        '</div>',
        [{ label: 'Cancel', cls: 'ghost', onClick: closeModal },
         { label: '<i class="fa-solid fa-vial"></i> Test now', cls: '', onClick: function () { wdFormTest(); } },
         { label: '<i class="fa-solid fa-shield-dog"></i> ' + (id ? 'Save' : 'Start watching'), cls: 'primary', onClick: function (e) { wdSave(id, e && e.currentTarget); } }], true);
    wdFormSync();
}
function wdFormSync() {
    var metric = $('wd-f-metric').value, rule = $('wd-f-rule').value;
    $('wd-f-col-wrap').style.display = metric === 'VALUE' ? '' : 'none';
    $('wd-f-thr-wrap').style.display = rule === 'AUTO' ? 'none' : '';
    $('wd-f-dir-wrap').style.display = rule === 'AUTO' || rule === 'CHANGE' ? '' : 'none';
    $('wd-f-sens-wrap').style.display = rule === 'AUTO' ? '' : 'none';
    $('wd-f-thr').placeholder = rule === 'CHANGE' ? '50  (%)' : '100';
    $('wd-f-hint').innerHTML = rule === 'AUTO'
        ? '<i class="fa-solid fa-wand-magic-sparkles"></i> Learns the normal range from its own runs — per weekday and time of day once it has enough of them — and alerts only when the number falls outside it. It stays quiet for the first ' + WD_ENGINE.MIN_HISTORY + ' runs while it learns.'
        : rule === 'CHANGE' ? 'Alerts when the number moves by more than the given percentage compared with the previous run.' : 'Alerts whenever the number is ' + (rule === 'ABOVE' ? 'above' : 'below') + ' the limit.';
}
function wdFormValues() {
    return {
        name: $('wd-f-name').value.trim(), instance: $('wd-f-inst').value, sql: $('wd-f-sql').value.trim().replace(/;\s*$/, ''),
        metric: $('wd-f-metric').value, column: $('wd-f-col').value.trim().toUpperCase(), unit: $('wd-f-unit').value.trim(),
        rule: $('wd-f-rule').value, threshold: $('wd-f-thr').value === '' ? null : +$('wd-f-thr').value, direction: $('wd-f-dir').value,
        sensitivity: $('wd-f-sens').value, every: +$('wd-f-every').value, cooldown: +$('wd-f-cd').value,
        notify: $('wd-f-notify').checked, hook: $('wd-f-hook').value.trim(), email: $('wd-f-email').value.trim(), description: $('wd-f-desc').value.trim()
    };
}
function wdValidate(v) {
    if (!v.name) return 'Give the watchdog a name';
    if (!/^\s*(SELECT|WITH)\b/i.test(v.sql)) return 'The query must start with SELECT or WITH';
    if (detectParams(v.sql).length) return 'Replace the {{parameters}} with values — a watchdog runs on its own';
    if (v.metric === 'VALUE' && !v.column) return 'Name the column that holds the number';
    if (v.rule !== 'AUTO' && (v.threshold == null || !isFinite(v.threshold))) return 'Enter the limit';
    if (v.hook && !/^https:\/\/[^\/]*(webhook\.office\.com|outlook\.office\.com|logic\.azure\.com|powerplatform\.com)\//i.test(v.hook)) return 'The Teams webhook must be a Teams / Power Automate https address';
    return null;
}
function wdFormTest() {
    var v = wdFormValues(), box = $('wd-f-test');
    var bad = !v.sql ? 'Write the query first' : !/^\s*(SELECT|WITH)\b/i.test(v.sql) ? 'The query must start with SELECT or WITH' : detectParams(v.sql).length ? 'Fill in the {{parameters}} first' : null;
    if (bad) { box.innerHTML = '<span class="wd-bad">' + esc(bad) + '</span>'; return; }
    if (v.instance !== currentInstance()) { box.innerHTML = '<span class="wd-bad">Switch Fusion SQL to ' + esc(v.instance) + ' to test it here.</span>'; return; }
    box.innerHTML = '<span class="fs-spinner" style="width:12px;height:12px;"></span> Running on ' + esc(v.instance) + '…';
    var t0 = Date.now();
    fsCall('fusionSqlExecute', { sql: WD_ENGINE.metricSql(v.sql, v.metric, v.column), rowLimit: v.metric === 'ROWS' ? 1 : 5, instance: v.instance }).then(function (r) {
        if (!r || !r.success) throw (r && r.error) || 'Query failed';
        var n = WD_ENGINE.metricValue(r, v.metric, v.column);
        if (!isFinite(n)) throw 'No number found' + (v.metric === 'VALUE' ? ' — columns: ' + (r.columns || []).join(', ') : '');
        box.innerHTML = '<span class="wd-good"><i class="fa-solid fa-check"></i> Right now: <b>' + esc(WD_ENGINE.fmt(n)) + '</b> ' + esc(v.unit || (v.metric === 'ROWS' ? 'rows' : '')) + '</span> <span class="fs-muted">· ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s</span>';
    }).catch(function (e) { box.innerHTML = '<span class="wd-bad">' + esc(String(e).split('\n')[0]) + '</span>'; });
}
function wdSave(id, btn) {
    var v = wdFormValues(), bad = wdValidate(v);
    if (bad) { toast(bad, 'warn'); return; }
    if (btn) btn.disabled = true;
    var user = vlit(appUserName(), 120);
    var cols = 'watch_name = ' + vlit(v.name, 200) + ', description = ' + vlit(v.description, 1000) + ', sql_text = ' + clobLit(v.sql) + ', instance = ' + lit(v.instance) +
        ', metric = ' + lit(v.metric) + ', value_column = ' + vlit(v.column, 128) + ', unit_label = ' + vlit(v.unit, 40) + ', rule_type = ' + lit(v.rule) +
        ', threshold = ' + wdNum(v.threshold) + ', direction = ' + lit(v.direction) + ', sensitivity = ' + lit(v.sensitivity) + ', every_min = ' + v.every +
        ', notify = ' + lit(v.notify ? 'Y' : 'N') + ', teams_webhook = ' + vlit(v.hook, 1000) + ', email_to = ' + vlit(v.email, 1000) + ', cooldown_hours = ' + v.cooldown;
    var sql = id
        ? 'UPDATE ' + WD_T + ' SET ' + cols + ', changed_by = ' + user + ', changed_date = SYSDATE WHERE watch_id = ' + (+id)
        : 'INSERT INTO ' + WD_T + ' (watch_name, description, sql_text, instance, metric, value_column, unit_label, rule_type, threshold, direction, sensitivity, every_min, notify, ' +
          'teams_webhook, email_to, cooldown_hours, status, next_run, created_by, created_date) VALUES (' + vlit(v.name, 200) + ', ' + vlit(v.description, 1000) + ', ' + clobLit(v.sql) + ', ' +
          lit(v.instance) + ', ' + lit(v.metric) + ', ' + vlit(v.column, 128) + ', ' + vlit(v.unit, 40) + ', ' + lit(v.rule) + ', ' + wdNum(v.threshold) + ', ' + lit(v.direction) + ', ' +
          lit(v.sensitivity) + ', ' + v.every + ', ' + lit(v.notify ? 'Y' : 'N') + ', ' + vlit(v.hook, 1000) + ', ' + vlit(v.email, 1000) + ', ' + v.cooldown + ", 'NEW', " + wdDate(Date.now()) + ', ' + user + ', SYSDATE)';
    wdEnsure().then(function () { return dbWrite(sql); }).then(function () {
        closeModal(); toast(id ? 'Watchdog saved' : '🐕 Watching "' + v.name + '" — first check in a minute');
        showTab('watchdogs');
        return wdLoad();
    }).then(function () {
        if (!id) { var w = WD.list.filter(function (x) { return x.name === v.name; }).pop(); if (w && w.instance === currentInstance()) wdRun(w.id, true); }
    }).catch(function (e) { toast('Could not save: ' + e, 'err'); if (btn) btn.disabled = false; });
}
function wdToggle(id) {
    var w = wdFind(id); if (!w) return;
    dbWrite('UPDATE ' + WD_T + ' SET active = ' + lit(w.active ? 'N' : 'Y') + (w.active ? '' : ', next_run = ' + wdDate(Date.now())) + ', changed_by = ' + vlit(appUserName(), 120) + ', changed_date = SYSDATE WHERE watch_id = ' + (+id))
        .then(function () { toast(w.active ? 'Paused "' + w.name + '"' : 'Resumed "' + w.name + '"'); return wdLoad(); })
        .catch(function (e) { toast('Could not save: ' + e, 'err'); });
}
function wdDelete(id) {
    var w = wdFind(id); if (!w) return;
    confirmModal('Delete watchdog', 'Delete "' + w.name + '" and its ' + w.runs + ' runs?', function () {
        dbWrite('DELETE FROM ' + WD_RUNS + ' WHERE watch_id = ' + (+id)).then(function () { return dbWrite('DELETE FROM ' + WD_T + ' WHERE watch_id = ' + (+id)); })
            .then(function () { toast('Deleted'); return wdLoad(); }).catch(function (e) { toast('Could not delete: ' + e, 'err'); });
    });
}
function wdOpenSql(id) { var w = wdFind(id); if (!w) return; setCurrentQuery(null); setSql(w.sql); showTab('builder'); }

// ── History ───────────────────────────────────────────────────
function wdHistoryView(id) {
    var w = wdFind(id); if (!w) return;
    openModal('History — ' + w.name, '<div class="fs-empty"><div class="fs-spinner"></div></div>', [{ label: 'Close', cls: 'primary', onClick: closeModal }], true);
    dbRead('SELECT metric_value, expected, low_value, high_value, status, message, elapsed_ms, notified, run_by, ' + "TO_CHAR(run_date, 'YYYY-MM-DD HH24:MI:SS') AS run_at FROM " + WD_RUNS +
        ' WHERE watch_id = ' + (+id) + ' ORDER BY run_date DESC FETCH FIRST 100 ROWS ONLY', 100).then(function (rows) {
        var pts = rows.slice().reverse().filter(function (r) { return r.METRIC_VALUE != null; }).map(function (r) { return { t: wdParse(r.RUN_AT), v: +r.METRIC_VALUE, lo: r.LOW_VALUE, hi: r.HIGH_VALUE, s: r.STATUS }; });
        $('fs-modal-body').innerHTML = '<div class="wd-hist-chart">' + wdSpark(pts, 760, 160, true) + '</div>' +
            '<table class="wd-hist"><thead><tr><th>When</th><th>Value</th><th>Normal range</th><th>Status</th><th>Message</th><th>Alert</th></tr></thead><tbody>' +
            rows.map(function (r) {
                return '<tr><td>' + esc(r.RUN_AT) + '</td><td><b>' + esc(WD_ENGINE.fmt(r.METRIC_VALUE == null ? NaN : +r.METRIC_VALUE)) + '</b></td><td>' +
                    (r.LOW_VALUE != null || r.HIGH_VALUE != null ? esc(WD_ENGINE.fmt(r.LOW_VALUE == null ? NaN : +r.LOW_VALUE)) + ' – ' + esc(WD_ENGINE.fmt(r.HIGH_VALUE == null ? NaN : +r.HIGH_VALUE)) : '—') + '</td><td>' +
                    wdBadge(r.STATUS) + '</td><td class="wd-msg">' + esc(r.MESSAGE || '') + '</td><td>' + (r.NOTIFIED === 'Y' ? '<i class="fa-solid fa-bell" title="Alert sent"></i>' : '') + '</td></tr>';
            }).join('') + '</tbody></table>';
    }).catch(function (e) { $('fs-modal-body').innerHTML = '<div class="fs-error-box">' + esc(e) + '</div>'; });
}

// ── Page ──────────────────────────────────────────────────────
function wdBadge(s) {
    var m = { ALERT: ['Unusual', 'alert', 'fa-bell'], OK: ['Normal', 'ok', 'fa-check'], LEARNING: ['Learning', 'learn', 'fa-graduation-cap'], ERROR: ['Error', 'err', 'fa-triangle-exclamation'], NEW: ['Waiting', 'new', 'fa-hourglass-half'], PAUSED: ['Paused', 'new', 'fa-pause'] }[s] || [s, 'new', 'fa-circle'];
    return '<span class="wd-badge ' + m[1] + '"><i class="fa-solid ' + m[2] + '"></i> ' + m[0] + '</span>';
}
/** Inline SVG line of the values with the latest normal band. */
function wdSpark(pts, W, H, axes) {
    pts = (pts || []).filter(function (p) { return isFinite(p.v); }).slice(-60);
    if (pts.length < 2) return '<div class="wd-spark-empty">' + (pts.length ? 'one run so far' : 'no runs yet') + '</div>';
    var last = pts[pts.length - 1];
    var vals = pts.map(function (p) { return p.v; });
    if (last.lo != null && isFinite(last.lo)) vals.push(+last.lo);
    if (last.hi != null && isFinite(last.hi)) vals.push(+last.hi);
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals); if (max === min) { max += 1; min -= 1; }
    var pad = axes ? 30 : 4, x = function (i) { return pad + i * (W - pad - 4) / (pts.length - 1); }, y = function (v) { return 4 + (H - 8 - (axes ? 14 : 0)) * (1 - (v - min) / (max - min)); };
    var band = last.lo != null && last.hi != null && isFinite(last.lo) && isFinite(last.hi)
        ? '<rect x="' + pad + '" y="' + y(+last.hi) + '" width="' + (W - pad - 4) + '" height="' + Math.max(1, y(+last.lo) - y(+last.hi)) + '" class="wd-band"/>' : '';
    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.v).toFixed(1); }).join(' ');
    var dots = pts.map(function (p, i) { return p.s === 'ALERT' ? '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(p.v).toFixed(1) + '" r="' + (axes ? 4 : 2.6) + '" class="wd-dot-alert"><title>' + esc(WD_ENGINE.fmt(p.v)) + '</title></circle>' : ''; }).join('');
    var ax = axes ? '<text x="2" y="' + (y(max) + 4) + '" class="wd-ax">' + esc(WD_ENGINE.fmt(max)) + '</text><text x="2" y="' + (y(min) + 4) + '" class="wd-ax">' + esc(WD_ENGINE.fmt(min)) + '</text>' +
        '<text x="' + pad + '" y="' + (H - 2) + '" class="wd-ax">' + esc(wdLocalIso(pts[0].t).slice(5, 16)) + '</text><text x="' + (W - 4) + '" y="' + (H - 2) + '" text-anchor="end" class="wd-ax">' + esc(wdLocalIso(last.t).slice(5, 16)) + '</text>' : '';
    return '<svg class="wd-spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" width="100%" height="' + H + '">' + band +
        '<path d="' + line + '" class="wd-line"/>' + dots + '<circle cx="' + x(pts.length - 1).toFixed(1) + '" cy="' + y(last.v).toFixed(1) + '" r="' + (axes ? 4 : 2.8) + '" class="wd-dot-last"/>' + ax + '</svg>';
}
function wdRule(w) {
    var u = w.unit || (w.metric === 'ROWS' ? 'rows' : '');
    if (w.rule === 'ABOVE') return 'alert above ' + WD_ENGINE.fmt(+w.threshold) + ' ' + u;
    if (w.rule === 'BELOW') return 'alert below ' + WD_ENGINE.fmt(+w.threshold) + ' ' + u;
    if (w.rule === 'CHANGE') return 'alert on a ' + WD_ENGINE.fmt(+w.threshold) + '% change';
    return 'learns what is normal · ' + ({ UP: 'alerts when higher', DOWN: 'alerts when lower', BOTH: 'alerts when higher or lower' }[w.direction] || '') + ' · ' + String(w.sensitivity).toLowerCase() + ' sensitivity';
}
function wdRenderRunner() {
    var el = $('wd-runner'); if (!el) return;
    var h = WD.lease.holder;
    el.innerHTML = WD.lease.mine
        ? '<i class="fa-solid fa-circle" style="color:var(--fs-green)"></i> This PC runs the schedule'
        : h ? '<i class="fa-solid fa-circle" style="color:var(--fs-blue)"></i> Schedule runs on ' + esc(h.split(' · ')[0])
        : '<i class="fa-regular fa-circle"></i> Schedule starts when Fusion SQL is open';
    el.title = 'Watchdogs run on one PC at a time — any PC with Fusion SQL open on the watchdog\'s pod. ' + (h ? 'Current: ' + h : '');
}
function wdRender() {
    var body = $('wd-body'); if (!body) { wdBadgeTab(); return; }
    wdBadgeTab(); wdRenderRunner();
    if (WD.state === 'loading' && !WD.list.length) { body.innerHTML = '<div class="fs-empty"><div class="fs-spinner"></div><p>Loading watchdogs…</p></div>'; return; }
    if (WD.state === 'error') { body.innerHTML = '<div class="fs-empty error"><i class="fa-solid fa-triangle-exclamation"></i><h3>Could not read the watchdogs</h3><div class="fs-error-box">' + esc(WD.error) + '</div></div>'; return; }
    if (!WD.list.length) {
        body.innerHTML = '<div class="fs-empty wd-empty"><i class="fa-solid fa-shield-dog"></i><h3>Let Fusion SQL keep an eye on things</h3>' +
            '<p class="fs-muted">A watchdog runs a query on a schedule, learns what is normal for every weekday and hour, and tells you on Teams or e-mail only when something is unusual — orders stuck in a status, failed interfaces, unbilled shipments, negative stock…</p>' +
            '<p class="fs-muted">Click <b>Watch this</b> under any query result or saved query, or start here.</p>' +
            '<button class="fs-btn primary" onclick="wdEdit()"><i class="fa-solid fa-plus"></i> New watchdog</button></div>';
        return;
    }
    var c = { ALERT: 0, OK: 0, LEARNING: 0, ERROR: 0 }, paused = 0;
    WD.list.forEach(function (w) { if (!w.active) paused++; else if (c[w.status] != null) c[w.status]++; });
    var sorted = WD.list.slice().sort(function (a, b) {
        var r = function (w) { return !w.active ? 5 : { ALERT: 0, ERROR: 1, LEARNING: 3, NEW: 3, OK: 4 }[w.status] || 4; };
        return r(a) - r(b) || a.name.localeCompare(b.name);
    });
    body.innerHTML = '<div class="kb-kpis">' +
        '<div class="kb-kpi' + (c.ALERT ? ' alert' : '') + '"><b>' + c.ALERT + '</b><span>unusual now</span></div>' +
        '<div class="kb-kpi"><b>' + c.OK + '</b><span>normal</span></div>' +
        '<div class="kb-kpi"><b>' + c.LEARNING + '</b><span>still learning</span></div>' +
        '<div class="kb-kpi' + (c.ERROR ? ' warn' : '') + '"><b>' + c.ERROR + '</b><span>errors</span></div>' +
        '<div class="kb-kpi"><b>' + paused + '</b><span>paused</span></div></div>' +
        '<div class="wd-grid">' + sorted.map(function (w) {
            var st = w.active ? w.status : 'PAUSED', other = w.instance !== currentInstance();
            return '<div class="wd-card ' + st.toLowerCase() + '">' +
                '<div class="wd-card-head"><div class="wd-name" title="' + esc(w.description) + '">' + esc(w.name) + '</div>' + wdBadge(st) + '</div>' +
                '<div class="wd-value"><b>' + (w.value == null ? '—' : esc(WD_ENGINE.fmt(+w.value))) + '</b> <span>' + esc(w.unit || (w.metric === 'ROWS' ? 'rows' : '')) + '</span>' +
                (WD.running[w.id] ? ' <span class="fs-spinner" style="width:12px;height:12px;"></span>' : '') + '</div>' +
                '<div class="wd-msg">' + esc(w.message || 'Not checked yet') + '</div>' +
                wdSpark(WD.spark[w.id], 300, 46, false) +
                '<div class="wd-meta"><span><i class="fa-regular fa-clock"></i> ' + esc((WD_EVERY.filter(function (e) { return e[0] === w.every; })[0] || [0, 'every ' + w.every + ' min'])[1]) + '</span>' +
                '<span>' + esc(w.active ? 'next ' + wdIn(w.nextRun) : 'paused') + '</span><span>last ' + esc(wdAgo(w.lastRun)) + '</span>' +
                '<span class="wd-pod' + (other ? ' other' : '') + '" title="' + (other ? 'Runs on a PC where Fusion SQL is on ' + esc(w.instance) : '') + '">' + esc(w.instance) + '</span>' +
                (w.notify ? '<span title="Alerts to Teams / e-mail"><i class="fa-solid fa-bell"></i></span>' : '<span title="No alerts"><i class="fa-regular fa-bell-slash"></i></span>') + '</div>' +
                '<div class="wd-rule-text">' + esc(wdRule(w)) + ' · ' + w.runs + ' runs, ' + w.alerts + ' alerts</div>' +
                '<div class="wd-acts"><button class="fs-btn sm primary" onclick="wdRun(' + w.id + ', true)"' + (WD.running[w.id] ? ' disabled' : '') + '><i class="fa-solid fa-play"></i> Check now</button>' +
                '<button class="fs-btn sm" onclick="wdHistoryView(' + w.id + ')"><i class="fa-solid fa-chart-line"></i> History</button>' +
                '<button class="fs-btn sm" onclick="wdOpenSql(' + w.id + ')" title="Open the query in the SQL Builder to see the records"><i class="fa-solid fa-table"></i> Data</button>' +
                '<span style="flex:1"></span>' +
                '<button class="fs-icon-btn" onclick="wdToggle(' + w.id + ')" title="' + (w.active ? 'Pause' : 'Resume') + '"><i class="fa-solid fa-' + (w.active ? 'pause' : 'play') + '"></i></button>' +
                '<button class="fs-icon-btn" onclick="wdEdit(' + w.id + ')" title="Edit"><i class="fa-solid fa-pen"></i></button>' +
                '<button class="fs-icon-btn" onclick="wdDelete(' + w.id + ')" title="Delete"><i class="fa-regular fa-trash-can"></i></button></div></div>';
        }).join('') + '</div>';
}
function wdBadgeTab() {
    var b = $('fs-wd-count'); if (!b) return;
    var alerts = WD.list.filter(function (w) { return w.active && w.status === 'ALERT'; }).length;
    b.textContent = alerts || WD.list.length;
    b.classList.toggle('muted', !alerts);
    b.classList.toggle('wd-tab-alert', !!alerts);
    b.title = alerts ? alerts + ' watchdog' + (alerts === 1 ? ' is' : 's are') + ' unusual' : WD.list.length + ' watchdogs';
}
function wdShow() { wdLoad(); }
