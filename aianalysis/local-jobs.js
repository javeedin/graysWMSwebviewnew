// ============================================================
// LOCAL JOB RUNNER — the frontend ("LOCAL" lane) scheduler
// ============================================================
// DB-lane jobs run inside Oracle (DBMS_SCHEDULER). LOCAL-lane jobs are
// stored in the SAME wms_ai_jobs table (lane='LOCAL') but Oracle does NOT
// run them — THIS app does, because their steps need the PC (printing, PDF
// download, email, local files). The app polls for due LOCAL jobs, claims
// one atomically (so two open apps don't double-run it), executes its steps
// via the WebView IPC bridge, then reports the run back so the frontend
// monitors them exactly like DB jobs (runs, status, next run).
//
// Endpoints (script apex_sql/56_ai_jobs_local_lane.sql):
//   GET  ai/jobs/list?lane=LOCAL&status=SCHEDULED   (existing list, lane-aware)
//   POST ai/jobs/localclaim   {jobId, machine}  -> {claimed, runId, stepsJson, ...}
//   POST ai/jobs/localreport  {jobId, runId, status, log, done, error}
// ============================================================
(function () {
    'use strict';

    var AI = (typeof AI_BASE !== 'undefined')
        ? AI_BASE
        : 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/ai';

    var POLL_MS = 60000;        // check for due LOCAL jobs every minute
    var running = {};           // jobId -> true while this app is executing it
    var timer = null;

    function machineId() {
        try {
            var m = localStorage.getItem('wms_local_runner_id');
            if (!m) { m = 'APP-' + Math.random().toString(36).slice(2, 8).toUpperCase(); localStorage.setItem('wms_local_runner_id', m); }
            return m;
        } catch (e) { return 'APP'; }
    }
    function appUser() { try { return (typeof appUserName === 'function' ? appUserName() : (localStorage.getItem('loggedInUser') || 'JOBRUNNER')); } catch (e) { return 'JOBRUNNER'; } }
    function inst() { try { return (typeof currentInstance === 'function' ? currentInstance() : 'PROD'); } catch (e) { return 'PROD'; } }

    // ── IPC bridge as a promise ─────────────────────────────
    function ipc(msg) {
        return new Promise(function (resolve, reject) {
            if (typeof sendMessageToCSharp !== 'function') { reject('bridge unavailable'); return; }
            sendMessageToCSharp(msg, function (err, data) { err ? reject(err) : resolve(data); });
        });
    }
    function getJson(url) {
        return ipc({ action: 'executeGet', fullUrl: url }).then(function (d) { return typeof d === 'string' ? JSON.parse(d) : d; });
    }
    function postJson(url, body) {
        return ipc({ action: 'executePost', fullUrl: url, body: JSON.stringify(body) }).then(function (d) { try { return typeof d === 'string' ? JSON.parse(d) : d; } catch (e) { return d; } });
    }
    // read query via the guarded gateway; returns {columns, rows}
    function query(sql) {
        return postJson(AI + '/executequery', { sql: sql, maxRows: 500, appUser: appUser() });
    }

    // ── {VAR} substitution + 1-based JSON path (mirrors the DB lane) ──
    function subst(v, vars) {
        if (v == null) return v;
        if (typeof v === 'string') return v.replace(/#([A-Za-z0-9_]+)#|\{([A-Za-z0-9_]+)\}/g, function (m, a, b) {
            var k = a || b; return (vars[k] !== undefined && vars[k] !== null) ? String(vars[k]) : m;
        });
        if (Array.isArray(v)) return v.map(function (x) { return subst(x, vars); });
        if (typeof v === 'object') { var o = {}; Object.keys(v).forEach(function (k) { o[k] = subst(v[k], vars); }); return o; }
        return v;
    }
    function jsonPath(obj, path) {
        // "items[1].FULFILL_LINE_ID" — arrays are 1-BASED like the DB runner
        var cur = obj, re = /([A-Za-z0-9_]+)|\[(\d+)\]/g, m;
        while ((m = re.exec(path)) !== null) {
            if (cur == null) return null;
            if (m[2] !== undefined) cur = cur[parseInt(m[2], 10) - 1];
            else cur = cur[m[1]];
        }
        return cur;
    }

    // ── one step ────────────────────────────────────────────
    // returns { log: [..], rows?: [...] }  (throws on hard failure)
    function runStep(step, vars, log) {
        var type = (step.type || 'rest').toLowerCase();

        if (type === 'rest') {
            var method = (step.method || 'GET').toUpperCase();
            var url = subst(step.url, vars);
            var body = step.body ? JSON.stringify(subst(step.body, vars)) : '{}';
            var call = method === 'GET' ? ipc({ action: 'executeGet', fullUrl: url })
                                        : ipc({ action: 'executePost', fullUrl: url, body: body });
            return call.then(function (d) {
                var j; try { j = typeof d === 'string' ? JSON.parse(d) : d; } catch (e) { j = null; }
                if (step.extract && j) Object.keys(step.extract).forEach(function (k) { vars[k] = jsonPath(j, step.extract[k]); });
                log.push('rest ' + method + ' ' + url + ' -> ok');
                return {};
            });
        }
        if (type === 'query') {
            return query(subst(step.sql, vars)).then(function (r) {
                var rows = (r && r.rows) || [];
                if (step.extract && r && r.columns) {
                    var ix = {}; r.columns.forEach(function (c, i) { ix[String(c).toUpperCase()] = i; });
                    var first = rows[0] || [];
                    Object.keys(step.extract).forEach(function (k) { var col = String(step.extract[k]).toUpperCase(); vars[k] = first[ix[col]]; });
                }
                log.push('query -> ' + rows.length + ' row(s)');
                return { rows: rows, columns: (r && r.columns) || [] };
            });
        }
        if (type === 'print') {
            return ipc({ action: 'printOrder', orderNumber: subst(step.orderNumber, vars), tripId: subst(step.tripId, vars) || '', printerName: subst(step.printer, vars) || '', instance: inst(), silent: true })
                .then(function () { log.push('print order ' + subst(step.orderNumber, vars)); return {}; });
        }
        if (type === 'download_pdf') {
            return ipc({ action: 'downloadOrderPdf', orderNumber: subst(step.orderNumber, vars), tripId: subst(step.tripId, vars) || '', instance: inst() })
                .then(function () { log.push('download pdf ' + subst(step.orderNumber, vars)); return {}; });
        }
        if (type === 'ipc') {
            // escape hatch: ANY local IPC action the app supports, with the
            // exact params the model provides (email, saveLocalFile, device ops…)
            var msg = Object.assign({ action: step.action }, subst(step.params || {}, vars));
            return ipc(msg).then(function () { log.push('ipc ' + step.action); return {}; });
        }
        if (type === 'foreach') {
            // { type:'forEach', query:{sql}, itemVar?, do:[ steps using {COL} ] }
            return query(subst(step.query && step.query.sql, vars)).then(function (r) {
                var cols = (r && r.columns) || [], rows = (r && r.rows) || [];
                var ix = {}; cols.forEach(function (c, i) { ix[String(c).toUpperCase()] = i; });
                log.push('forEach -> ' + rows.length + ' row(s)');
                return rows.reduce(function (p, row) {
                    return p.then(function () {
                        var rowVars = Object.assign({}, vars);
                        cols.forEach(function (c) { rowVars[String(c).toUpperCase()] = row[ix[String(c).toUpperCase()]]; });
                        return (step.do || []).reduce(function (pp, s) { return pp.then(function () { return runStep(s, rowVars, log); }); }, Promise.resolve());
                    });
                }, Promise.resolve());
            });
        }
        log.push('skip unknown step type "' + type + '"');
        return Promise.resolve({});
    }

    // ── run one claimed job end-to-end ──────────────────────
    function executeClaimed(jobId, claim) {
        var vars = {}, log = [];
        var steps = [];
        try { var s = typeof claim.stepsJson === 'string' ? JSON.parse(claim.stepsJson) : claim.stepsJson; steps = (s && s.steps) || []; } catch (e) { log.push('bad stepsJson: ' + e); }

        var chain = steps.reduce(function (p, step) { return p.then(function () { return runStep(step, vars, log); }); }, Promise.resolve());

        return chain.then(function () {
            // completion check for REPEAT_UNTIL_DONE
            if (claim.scheduleType === 'REPEAT_UNTIL_DONE' && claim.completionSql) {
                return query(claim.completionSql).then(function (r) {
                    var n = ((r && r.rows) || []).length;
                    log.push('completionSql -> ' + n + ' row(s) ' + (n === 0 ? '(DONE)' : '(more to do)'));
                    return { ok: true, done: n === 0 };
                }).catch(function (e) { log.push('completionSql error: ' + e); return { ok: true, done: false }; });
            }
            return { ok: true, done: false };
        }).then(function (res) {
            return report(jobId, claim.runId, res.ok ? 'SUCCESS' : 'FAILED', log.join('\n'), res.done, '');
        }).catch(function (err) {
            log.push('FAILED: ' + err);
            return report(jobId, claim.runId, 'FAILED', log.join('\n'), false, String(err));
        });
    }
    function report(jobId, runId, status, log, done, error) {
        return postJson(AI + '/jobs/localreport', { jobId: jobId, runId: runId, status: status, log: log, done: !!done, error: error || '' })
            .then(function () { if (typeof loadJobs === 'function' && document.getElementById('jb-list')) { try { loadJobs(); } catch (e) { } } })
            .catch(function () { });
    }

    // ── poll: find due LOCAL jobs, claim + run them ─────────
    function poll() {
        var url = AI + '/jobs/list?lane=LOCAL&status=SCHEDULED&t=' + Date.now();
        getJson(url).then(function (parsed) {
            var jobs = (parsed && parsed.jobs) || [];
            jobs.forEach(function (j) {
                if (j.lane && j.lane !== 'LOCAL') return;
                if (running[j.jobId]) return;                       // this app already running it
                if (j.instance && inst() && j.instance !== inst()) return; // only run current-instance jobs
                running[j.jobId] = true;
                postJson(AI + '/jobs/localclaim', { jobId: j.jobId, machine: machineId() })
                    .then(function (c) {
                        if (!c || !c.claimed) { delete running[j.jobId]; return; }
                        return executeClaimed(j.jobId, c).then(function () { delete running[j.jobId]; });
                    })
                    .catch(function () { delete running[j.jobId]; });
            });
        }).catch(function () { /* endpoint not deployed yet — stay quiet */ });
    }

    window.LocalJobs = {
        init: function () {
            if (timer) return;
            // small delay so the WebView bridge + AI_BASE are ready
            setTimeout(poll, 4000);
            timer = setInterval(poll, POLL_MS);
        },
        pollNow: poll,
        stop: function () { if (timer) { clearInterval(timer); timer = null; } }
    };
})();
