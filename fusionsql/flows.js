/* ═══════════════════════════════════════════════════════════════
   Fusion SQL — Process Flows
   A flow follows ONE business document through Fusion as a chain of
   small read-only SQL steps (e.g. Order to Cash). Steps hand keys on:
   a step lists `outputs` (column names); later steps use them as
   IN ({{KEY}}) or IN ({{KEY:str}}). Flow parameters are {{P_...}}.
   Running a flow executes the steps in order through the BIP runner,
   colours the diagram (rows / 0 rows = where it stops / error) and
   builds a report with headline figures (e.g. revenue, COGS, margin).

   Stored in the APEX DB (apex_sql/68_fusion_flows.sql, auto-created):
     WMS_FUSION_FLOWS       one row per flow
     WMS_FUSION_FLOW_STEPS  its steps, SQL in a CLOB
     WMS_FUSION_FLOW_RUNS   run history (params, rows per step, stop point)
   ═══════════════════════════════════════════════════════════════ */

var FL = {
    state: 'loading',       // loading | ready | missing | offline
    error: null,
    list: [],               // [{ id, name, description, steps, source, createdBy, updated, lastRun, lastStatus }]
    selId: null,
    flow: null,             // full flow { id, name, description, params[], summary[], steps[] }
    run: null,              // { params, st: {key: {status,rows,cols,sql,error,ms,values}}, keys, done, stoppedAt }
    stepSel: null,
    stepTab: 'data',
    runs: [],
    fixTarget: null         // { flowId, stepKey } while "Ask AI to fix this step" is open
};
var FL_T = 'wms_fusion_flows', FL_S = 'wms_fusion_flow_steps', FL_R = 'wms_fusion_flow_runs';
var FL_DDL = {
    WMS_FUSION_FLOWS: [
        'CREATE TABLE wms_fusion_flows (flow_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, flow_name VARCHAR2(200) NOT NULL, ' +
        'description VARCHAR2(2000), params_json VARCHAR2(4000), summary_json VARCHAR2(4000), source VARCHAR2(10) DEFAULT \'USER\', ' +
        'created_by VARCHAR2(120), created_date DATE DEFAULT SYSDATE, updated_by VARCHAR2(120), updated_date DATE)',
        'CREATE UNIQUE INDEX wms_fusion_flows_name_ux ON wms_fusion_flows (UPPER(flow_name))'
    ],
    WMS_FUSION_FLOW_STEPS: [
        'CREATE TABLE wms_fusion_flow_steps (step_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, flow_id NUMBER NOT NULL, ' +
        'step_no NUMBER NOT NULL, step_key VARCHAR2(30) NOT NULL, step_name VARCHAR2(200) NOT NULL, module VARCHAR2(20), ' +
        'parents VARCHAR2(400), outputs VARCHAR2(1000), measure_col VARCHAR2(128), hint VARCHAR2(1000), sql_text CLOB NOT NULL)',
        'CREATE INDEX wms_fusion_flow_steps_fx ON wms_fusion_flow_steps (flow_id, step_no)'
    ],
    WMS_FUSION_FLOW_RUNS: [
        'CREATE TABLE wms_fusion_flow_runs (run_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, flow_id NUMBER NOT NULL, ' +
        'params_json VARCHAR2(2000), instance VARCHAR2(10), run_by VARCHAR2(120), run_date DATE DEFAULT SYSDATE, ' +
        'status VARCHAR2(20), stopped_at VARCHAR2(300), step_counts VARCHAR2(4000), elapsed_ms NUMBER)',
        'CREATE INDEX wms_fusion_flow_runs_fx ON wms_fusion_flow_runs (flow_id, run_date)'
    ]
};
var FL_MODULES = {
    OM: ['Order Management', '#2a78d6'], PO: ['Purchasing', '#2a78d6'],
    WSH: ['Shipping', '#eb6834'], RCV: ['Receiving', '#eb6834'],
    INV: ['Inventory', '#1baf7a'], CST: ['Costing', '#c98500'],
    AR: ['Receivables', '#d55181'], AP: ['Payables', '#d55181'],
    XLA: ['Subledger Accounting', '#4a3aa7'], GL: ['General Ledger', '#4a3aa7'],
    OTHER: ['Other', '#57504b']
};
var FL_MAX_KEYS = 1000;              // Oracle IN-list limit
function flMod(m) { return FL_MODULES[m] || FL_MODULES.OTHER; }

// ── database ───────────────────────────────────────────────────
function flEnsureTables() {
    return dbRead("SELECT table_name FROM user_tables WHERE table_name IN ('WMS_FUSION_FLOWS','WMS_FUSION_FLOW_STEPS','WMS_FUSION_FLOW_RUNS')", 5).then(function (r) {
        var have = {}; r.forEach(function (x) { have[x.TABLE_NAME] = 1; });
        var todo = [];
        Object.keys(FL_DDL).forEach(function (t) { if (!have[t]) todo = todo.concat(FL_DDL[t]); });
        if (todo.length) toast('Creating the flow tables in the APEX database…', 'warn');
        return todo.reduce(function (p, ddl) { return p.then(function () { return dbWrite(ddl); }); }, Promise.resolve());
    });
}
function flLoadList() {
    if (FL.state !== 'ready') FL.state = 'loading';
    flRenderList();
    return dbRead('SELECT f.flow_id, f.flow_name, f.description, f.source, f.created_by, ' +
        "TO_CHAR(NVL(f.updated_date, f.created_date), 'YYYY-MM-DD HH24:MI') AS updated, " +
        '(SELECT COUNT(*) FROM ' + FL_S + ' s WHERE s.flow_id = f.flow_id) AS step_count, ' +
        "(SELECT TO_CHAR(MAX(r.run_date), 'YYYY-MM-DD HH24:MI') FROM " + FL_R + ' r WHERE r.flow_id = f.flow_id) AS last_run ' +
        'FROM ' + FL_T + ' f ORDER BY UPPER(f.flow_name)', 500).then(function (rows) {
            FL.state = 'ready'; FL.error = null;
            FL.list = rows.map(function (r) {
                return { id: r.FLOW_ID, name: r.FLOW_NAME, description: r.DESCRIPTION || '', source: r.SOURCE, createdBy: r.CREATED_BY, updated: r.UPDATED, steps: +r.STEP_COUNT || 0, lastRun: r.LAST_RUN };
            });
        }).catch(function (e) {
            FL.error = String(e);
            FL.state = /ORA-00942|does not exist/i.test(FL.error) ? 'missing' : 'offline';
            FL.list = [];
        }).then(function () {
            var b = $('fs-flows-count'); if (b) { b.textContent = FL.list.length; b.classList.toggle('muted', !FL.list.length); }
            if (FL.selId && !FL.list.some(function (f) { return String(f.id) === String(FL.selId); })) { FL.selId = null; FL.flow = null; }
            if (!FL.selId && FL.list.length) return flSelect(FL.list[0].id);
            flRenderList(); flRenderMain();
        });
}
function flLoadFlow(id) {
    var pieces = [];
    for (var i = 0; i < SQL_PIECES; i++) pieces.push('TO_CHAR(SUBSTR(sql_text, ' + (i * SQL_PIECE + 1) + ', ' + SQL_PIECE + ')) AS p' + i);
    var fid = parseInt(id, 10);
    return Promise.all([
        dbRead('SELECT flow_id, flow_name, description, params_json, summary_json, source, created_by, updated_by, ' +
            "TO_CHAR(created_date, 'YYYY-MM-DD HH24:MI') AS created, TO_CHAR(updated_date, 'YYYY-MM-DD HH24:MI') AS updated FROM " + FL_T + ' WHERE flow_id = ' + fid, 1),
        dbRead('SELECT step_no, step_key, step_name, module, parents, outputs, measure_col, hint, ' + pieces.join(', ') +
            ' FROM ' + FL_S + ' WHERE flow_id = ' + fid + ' ORDER BY step_no', 200),
        dbRead('SELECT run_id, params_json, instance, run_by, status, stopped_at, step_counts, elapsed_ms, ' +
            "TO_CHAR(run_date, 'YYYY-MM-DD HH24:MI') AS run_date FROM " + FL_R + ' WHERE flow_id = ' + fid + ' ORDER BY run_id DESC', 10).catch(function () { return []; })
    ]).then(function (res) {
        var h = res[0][0]; if (!h) throw 'Flow not found';
        var js = function (s, d) { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } };
        var csv = function (s) { return String(s || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); };
        FL.runs = res[2].map(function (r) { return { id: r.RUN_ID, params: js(r.PARAMS_JSON, {}), instance: r.INSTANCE, by: r.RUN_BY, status: r.STATUS, stoppedAt: r.STOPPED_AT, counts: js(r.STEP_COUNTS, {}), ms: r.ELAPSED_MS, date: r.RUN_DATE }; });
        return {
            id: h.FLOW_ID, name: h.FLOW_NAME, description: h.DESCRIPTION || '', source: h.SOURCE,
            params: js(h.PARAMS_JSON, []), summary: js(h.SUMMARY_JSON, []),
            createdBy: h.CREATED_BY, created: h.CREATED, updatedBy: h.UPDATED_BY, updated: h.UPDATED,
            steps: res[1].map(function (r) {
                var text = ''; for (var i = 0; i < SQL_PIECES; i++) text += r['P' + i] || '';
                return { key: r.STEP_KEY, name: r.STEP_NAME, module: r.MODULE || 'OTHER', parents: csv(r.PARENTS), outputs: csv(r.OUTPUTS).map(function (x) { return x.toUpperCase(); }), measure: (r.MEASURE_COL || '').toUpperCase(), hint: r.HINT || '', sql: text };
            })
        };
    });
}
/** Normalises a flow object (from AI JSON, the seed or the editor) before it is saved or shown. */
function flNormalize(f) {
    var steps = (f.steps || []).map(function (s, i) {
        return {
            key: String(s.key || ('S' + (i + 1))).toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 30) || 'S' + (i + 1),
            name: String(s.name || 'Step ' + (i + 1)).slice(0, 200),
            module: FL_MODULES[String(s.module || '').toUpperCase()] ? String(s.module).toUpperCase() : 'OTHER',
            parents: (s.parents || []).map(function (p) { return String(p).toUpperCase(); }),
            outputs: (s.outputs || []).map(function (o) { return String(o).toUpperCase().trim(); }).filter(Boolean),
            measure: String(s.measure || '').toUpperCase(),
            hint: String(s.hint || '').slice(0, 1000),
            sql: String(s.sql || '').trim().replace(/;\s*$/, '')
        };
    });
    var keys = {}; steps.forEach(function (s) { keys[s.key] = 1; });
    steps.forEach(function (s) { s.parents = s.parents.filter(function (p) { return keys[p] && p !== s.key; }); });
    return {
        id: f.id || null, name: String(f.name || '').trim().slice(0, 200), description: String(f.description || '').slice(0, 2000),
        params: (f.params || []).map(function (p) { return typeof p === 'string' ? { name: p.toUpperCase(), label: p } : { name: String(p.name || '').toUpperCase(), label: p.label || p.name, sample: p.sample || '' }; }).filter(function (p) { return p.name; }),
        summary: (f.summary || []).filter(function (x) { return x && x.label; }),
        steps: steps, source: f.source || 'USER'
    };
}
/** Saves the whole flow: MERGE the header by name, then replace its steps (one statement per call). */
function flSave(flow) {
    var F = flNormalize(flow);
    if (!F.name) return Promise.reject('The flow needs a name');
    if (!F.steps.length) return Promise.reject('The flow has no steps');
    var bad = F.steps.filter(function (s) { return !/^\s*(SELECT|WITH)\b/i.test(s.sql); })[0];
    if (bad) return Promise.reject('Step "' + bad.name + '" must be a SELECT');
    var user = vlit(appUserName(), 120), fid;
    return flEnsureTables().then(function () {
        return dbWrite('MERGE INTO ' + FL_T + ' t USING (SELECT ' + vlit(F.name, 200) + ' AS flow_name FROM dual) s ON (UPPER(t.flow_name) = UPPER(s.flow_name)) ' +
            'WHEN MATCHED THEN UPDATE SET t.description = ' + vlit(F.description, 2000) + ', t.params_json = ' + vlit(JSON.stringify(F.params), 4000) +
            ', t.summary_json = ' + vlit(JSON.stringify(F.summary), 4000) + ', t.updated_by = ' + user + ', t.updated_date = SYSDATE ' +
            'WHEN NOT MATCHED THEN INSERT (flow_name, description, params_json, summary_json, source, created_by, created_date) VALUES (' +
            's.flow_name, ' + vlit(F.description, 2000) + ', ' + vlit(JSON.stringify(F.params), 4000) + ', ' + vlit(JSON.stringify(F.summary), 4000) + ', ' +
            vlit(F.source, 10) + ', ' + user + ', SYSDATE)');
    }).then(function () {
        return dbRead('SELECT flow_id FROM ' + FL_T + ' WHERE UPPER(flow_name) = UPPER(' + vlit(F.name, 200) + ')', 1);
    }).then(function (r) {
        fid = parseInt(r[0].FLOW_ID, 10);
        return dbWrite('DELETE FROM ' + FL_S + ' WHERE flow_id = ' + fid);
    }).then(function () {
        return F.steps.reduce(function (p, s, i) {
            return p.then(function () {
                return dbWrite('INSERT INTO ' + FL_S + ' (flow_id, step_no, step_key, step_name, module, parents, outputs, measure_col, hint, sql_text) VALUES (' +
                    fid + ', ' + (i + 1) + ', ' + vlit(s.key, 30) + ', ' + vlit(s.name, 200) + ', ' + vlit(s.module, 20) + ', ' + vlit(s.parents.join(','), 400) + ', ' +
                    vlit(s.outputs.join(','), 1000) + ', ' + vlit(s.measure, 128) + ', ' + vlit(s.hint, 1000) + ', ' + clobLit(s.sql) + ')');
            });
        }, Promise.resolve());
    }).then(function () { return fid; });
}
function flLoadStarter() {
    var seeds = window.FS_FLOW_SEED || [];
    var have = {}; FL.list.forEach(function (f) { have[f.name.toUpperCase()] = 1; });
    var todo = seeds.filter(function (s) { return !have[s.name.toUpperCase()]; });
    if (!todo.length) { toast('The starter flows are already loaded'); return; }
    toast('Loading ' + todo.length + ' starter flow' + (todo.length === 1 ? '' : 's') + '…', 'warn');
    todo.reduce(function (p, s) { return p.then(function () { return flSave(Object.assign({}, s, { source: 'SEED' })); }); }, Promise.resolve())
        .then(function () { toast('Starter flows loaded'); return flLoadList(); })
        .catch(function (e) { toast('Could not load starter flows: ' + e, 'err'); flLoadList(); });
}

// ── selection ──────────────────────────────────────────────────
function flSelect(id) {
    FL.selId = id; FL.run = null; FL.stepSel = null;
    flRenderList();
    $('fl-main').innerHTML = '<div class="fs-muted" style="padding:30px;"><span class="fs-spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:middle;"></span> Loading flow…</div>';
    return flLoadFlow(id).then(function (f) {
        if (String(FL.selId) !== String(id)) return;
        FL.flow = f; FL.stepSel = f.steps[0] ? f.steps[0].key : null;
        flRenderList(); flRenderMain();
    }).catch(function (e) { $('fl-main').innerHTML = '<div class="fs-error-box" style="margin:10px;">' + esc(e) + '</div>'; });
}

// ── layout (depth = longest path from a root) ──────────────────
function flLayout(steps) {
    var byKey = {}, depth = {};
    steps.forEach(function (s) { byKey[s.key] = s; });
    var d = function (k, seen) {
        if (depth[k] != null) return depth[k];
        if (seen[k]) return 0;
        seen[k] = 1;
        var s = byKey[k], v = 0;
        (s.parents || []).forEach(function (p) { if (byKey[p]) v = Math.max(v, d(p, seen) + 1); });
        return (depth[k] = v);
    };
    steps.forEach(function (s) { d(s.key, {}); });
    var cols = {}, pos = {};
    steps.forEach(function (s) { var c = depth[s.key]; (cols[c] = cols[c] || []).push(s.key); });
    var W = 196, H = 84, GX = 64, GY = 22, maxRows = 0;
    Object.keys(cols).forEach(function (c) {
        cols[c].forEach(function (k, i) { pos[k] = { x: 16 + c * (W + GX), y: 16 + i * (H + GY), w: W, h: H }; });
        maxRows = Math.max(maxRows, cols[c].length);
    });
    var ncol = Object.keys(cols).length;
    return { pos: pos, width: 32 + ncol * W + (ncol - 1) * GX, height: 32 + maxRows * H + (maxRows - 1) * GY };
}
/** Execution order: parents first, then the saved step order. */
function flOrder(steps) {
    var done = {}, out = [], guard = 0;
    while (out.length < steps.length && guard++ < 1000) {
        var progressed = false;
        steps.forEach(function (s) {
            if (done[s.key]) return;
            if ((s.parents || []).every(function (p) { return done[p] || !steps.some(function (x) { return x.key === p; }); })) { done[s.key] = 1; out.push(s); progressed = true; }
        });
        if (!progressed) steps.forEach(function (s) { if (!done[s.key]) { done[s.key] = 1; out.push(s); } });
    }
    return out;
}

// ── render: list ───────────────────────────────────────────────
function flRenderList() {
    var el = $('fl-list'); if (!el) return;
    var term = (($('fl-search') || {}).value || '').toLowerCase();
    if (FL.state === 'loading' && !FL.list.length) { el.innerHTML = '<div class="ds-none">Loading…</div>'; return; }
    if (FL.state === 'missing' || (FL.state === 'ready' && !FL.list.length)) {
        el.innerHTML = '<div class="ds-none">No flows yet.</div>';
        return;
    }
    if (FL.state === 'offline') { el.innerHTML = '<div class="ds-none">APEX database not reachable.<br><small>' + esc((FL.error || '').slice(0, 140)) + '</small></div>'; return; }
    var list = FL.list.filter(function (f) { return !term || (f.name + ' ' + f.description).toLowerCase().indexOf(term) >= 0; });
    el.innerHTML = '<div class="ds-sec"><i class="fa-solid fa-diagram-project"></i> Flows <span>' + list.length + '</span></div>' + (list.map(function (f) {
        return '<div class="ds-item' + (String(f.id) === String(FL.selId) ? ' sel' : '') + '" onclick="flSelect(' + parseInt(f.id, 10) + ')">' +
            '<i class="fa-solid fa-diagram-project ds-ticon"></i><div class="ds-item-body"><div class="ds-item-name">' + esc(f.name) + '</div>' +
            (f.description ? '<div class="q-item-desc">' + esc(f.description) + '</div>' : '') +
            '<div class="ds-item-meta"><span><i class="fa-solid fa-shoe-prints"></i> ' + f.steps + ' steps</span>' +
            (f.lastRun ? '<span><i class="fa-regular fa-clock"></i> ' + esc(dsAgo(f.lastRun)) + '</span>' : '') +
            (f.source === 'SEED' ? '<span class="ds-mode">STARTER</span>' : f.source === 'AI' ? '<span class="ds-mode">AI</span>' : '') + '</div></div></div>';
    }).join('') || '<div class="ds-none">No flows match.</div>');
}

// ── render: main ───────────────────────────────────────────────
function flRenderMain() {
    var el = $('fl-main'); if (!el) return;
    if (FL.state === 'missing' || (FL.state === 'ready' && !FL.list.length)) {
        el.innerHTML = '<div class="ds-empty"><div class="ds-empty-icon"><i class="fa-solid fa-diagram-project"></i></div>' +
            '<h3>Follow a document end to end</h3>' +
            '<ol><li>A <b>flow</b> is a chain of small SQL steps — e.g. Order → Shipment → Inventory → Costing → AR invoice → Accounting → Receipt.</li>' +
            '<li>Run it for one order number: every step lights up with its rows, and the first empty step shows <b>where the order stopped</b> and what to run.</li>' +
            '<li>The <b>Flow report</b> puts all stages together with revenue, COGS and margin.</li></ol>' +
            '<div class="ds-empty-actions"><button class="fs-btn primary" onclick="flOpenLibrary()"><i class="fa-solid fa-book-open"></i> Browse the Fusion flow library</button>' +
            '<button class="fs-btn" onclick="flLoadStarter()"><i class="fa-solid fa-seedling"></i> Load starter flows (OTC, P2P)</button>' +
            '<button class="fs-btn ai" onclick="flNewWithAi()"><i class="fa-solid fa-wand-magic-sparkles"></i> Design a flow with AI</button>' +
            '<button class="fs-btn" onclick="flEditFlow(true)"><i class="fa-solid fa-plus"></i> Build one by hand</button></div></div>';
        return;
    }
    var F = FL.flow; if (!F) { el.innerHTML = ''; return; }
    var saved = lsGet('fusionSql.flowParams.' + F.id, {});
    var R = FL.run;
    el.innerHTML =
        '<div class="fs-card ds-detail fl-head">' +
        '<div class="ds-detail-head"><div style="min-width:0;"><div class="ds-detail-name"><i class="fa-solid fa-diagram-project" style="color:var(--fs-red)"></i> ' + esc(F.name) + '</div>' +
        (F.description ? '<p class="ds-detail-desc" style="margin:4px 0 0;">' + esc(F.description) + '</p>' : '') + '</div>' +
        '<div class="ds-detail-badges">' + (F.source === 'SEED' ? '<span class="fs-q-tag" style="background:#f1edea;color:#57504b;">STARTER</span>' : F.source === 'AI' ? '<span class="fs-q-tag">AI</span>' : '') +
        '<span class="fs-q-tag" style="background:#f1edea;color:#57504b;">' + F.steps.length + ' steps</span></div></div>' +
        '<div class="fl-runbar">' +
        (F.params.length ? F.params.map(function (p) {
            return '<label class="fl-param"><span>' + esc(p.label || p.name) + '</span><input data-p="' + esc(p.name) + '" value="' + esc(saved[p.name] != null ? saved[p.name] : (p.sample || '')) + '" placeholder="' + esc(p.name) + '" onkeydown="if(event.key===\'Enter\')flRun()"></label>';
        }).join('') : '<span class="fs-muted" style="font-size:.78rem;">No parameters</span>') +
        '<label class="fl-param narrow"><span>Rows / step</span><input id="fl-limit" type="number" min="1" max="5000" value="' + (lsGet('fusionSql.flowLimit', 500)) + '"></label>' +
        '<button class="fs-btn primary q-run-btn" id="fl-run-btn" onclick="flRun()"' + (R && !R.done ? ' disabled' : '') + '><i class="fa-solid fa-play"></i> Run flow</button>' +
        (R && !R.done ? '<button class="fs-btn" onclick="FL.run.stop=true"><i class="fa-solid fa-stop"></i> Stop</button>' : '') +
        (R && R.done ? '<button class="fs-btn rp-launch" onclick="flOpenReport()"><i class="fa-solid fa-wand-magic-sparkles"></i> Flow report</button>' : '') +
        '<span style="flex:1"></span>' +
        '<button class="fs-icon-btn" title="Edit flow (name, parameters, figures)" onclick="flEditFlow()"><i class="fa-solid fa-pen"></i></button>' +
        '<button class="fs-icon-btn" title="Add a step" onclick="flEditStep(null)"><i class="fa-solid fa-plus"></i></button>' +
        '<button class="fs-icon-btn" title="Ask AI to improve this flow" onclick="flAiImprove()"><i class="fa-solid fa-wand-magic-sparkles"></i></button>' +
        '<button class="fs-icon-btn" title="Duplicate" onclick="flDuplicate()"><i class="fa-regular fa-clone"></i></button>' +
        '<button class="fs-icon-btn" title="Delete flow" onclick="flDelete()"><i class="fa-regular fa-trash-can"></i></button>' +
        '</div>' + flStatusBanner() + '</div>' +
        '<div class="fs-card fl-diagram-card"><div class="fl-diagram-wrap"><div class="fl-diagram" id="fl-diagram"></div></div>' + flSummaryStrip() + '</div>' +
        '<div class="fs-card fl-step-card" id="fl-step"></div>' +
        (FL.runs.length ? '<div class="fs-card fl-runs"><h3><i class="fa-solid fa-clock-rotate-left"></i> Recent runs</h3><table class="ds-cols"><thead><tr><th>When</th><th>By</th><th>Parameters</th><th>Result</th><th></th></tr></thead><tbody>' +
            FL.runs.map(function (r, i) {
                return '<tr><td>' + esc(r.date) + '</td><td>' + esc(r.by || '') + '</td><td><code>' + esc(Object.keys(r.params).map(function (k) { return k + '=' + r.params[k]; }).join(', ')) + '</code></td>' +
                    '<td>' + (r.status === 'COMPLETE' ? '<span class="ds-st ds-st-ok">Complete</span>' : '<span class="ds-st ds-st-running">Stops at ' + esc(r.stoppedAt || '?') + '</span>') + '</td>' +
                    '<td><button class="fs-btn sm" onclick="flRerun(' + i + ')"><i class="fa-solid fa-rotate-right"></i> Run again</button></td></tr>';
            }).join('') + '</tbody></table></div>' : '');
    flRenderDiagram();
    flRenderStep();
}
function flStatusBanner() {
    var R = FL.run; if (!R) return '';
    var F = FL.flow;
    if (!R.done) {
        var n = Object.keys(R.st).filter(function (k) { return R.st[k].status !== 'pending' && R.st[k].status !== 'running'; }).length;
        return '<div class="fl-banner run"><span class="fs-spinner" style="width:13px;height:13px;border-width:2px;display:inline-block;"></span> Running step ' + Math.min(n + 1, F.steps.length) + ' of ' + F.steps.length + '…</div>';
    }
    if (!R.stoppedAt) return '<div class="fl-banner ok"><i class="fa-solid fa-circle-check"></i> Complete — every step found data (' + fmtMs(R.ms) + ').</div>';
    var s = F.steps.filter(function (x) { return x.key === R.stoppedAt; })[0], st = R.st[R.stoppedAt] || {};
    return '<div class="fl-banner stop"><i class="fa-solid fa-triangle-exclamation"></i><div><b>Stops at "' + esc(s ? s.name : R.stoppedAt) + '"</b> — ' +
        (st.status === 'error' ? 'the step failed: ' + esc(String(st.error).split('\n')[0].slice(0, 200)) : st.status === 'blocked' ? 'no ' + esc(st.missing || 'input keys') + ' from the steps before it.' : '0 rows.') +
        (s && s.hint && st.status !== 'error' ? '<br><span class="fl-hint"><i class="fa-regular fa-lightbulb"></i> ' + esc(s.hint) + '</span>' : '') + '</div></div>';
}
function flRenderDiagram() {
    var box = $('fl-diagram'); if (!box || !FL.flow) return;
    var F = FL.flow, L = flLayout(F.steps), R = FL.run;
    box.style.width = L.width + 'px'; box.style.height = L.height + 'px';
    var svg = ['<svg class="fl-edges" width="' + L.width + '" height="' + L.height + '"><defs>' +
        '<marker id="fl-arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#b8b0aa"/></marker>' +
        '<marker id="fl-arr-ok" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#15803d"/></marker></defs>'];
    F.steps.forEach(function (s) {
        (s.parents || []).forEach(function (p) {
            var a = L.pos[p], b = L.pos[s.key]; if (!a || !b) return;
            var x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x - 2, y2 = b.y + b.h / 2, mx = (x1 + x2) / 2;
            var ok = R && R.st[p] && R.st[p].status === 'ok' && R.st[s.key] && R.st[s.key].status === 'ok';
            var dead = R && R.done && R.st[s.key] && /blocked|empty|error/.test(R.st[s.key].status);
            svg.push('<path d="M' + x1 + ',' + y1 + ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2 + '" class="fl-edge' + (ok ? ' ok' : '') + (dead ? ' dead' : '') + '" marker-end="url(#' + (ok ? 'fl-arr-ok' : 'fl-arr') + ')"/>');
        });
    });
    svg.push('</svg>');
    var nodes = F.steps.map(function (s, i) {
        var p = L.pos[s.key], m = flMod(s.module), st = R && R.st[s.key] ? R.st[s.key] : null;
        var status = !st ? '<span class="fl-st idle">not run</span>'
            : st.status === 'pending' ? '<span class="fl-st idle">waiting</span>'
            : st.status === 'running' ? '<span class="fl-st run"><i class="fa-solid fa-spinner fa-spin"></i> running</span>'
            : st.status === 'ok' ? '<span class="fl-st ok"><i class="fa-solid fa-check"></i> ' + st.rows.length.toLocaleString() + (st.capped ? '+' : '') + ' rows</span>'
            : st.status === 'empty' ? '<span class="fl-st empty"><i class="fa-solid fa-circle-exclamation"></i> 0 rows</span>'
            : st.status === 'blocked' ? '<span class="fl-st blocked"><i class="fa-solid fa-ban"></i> no input</span>'
            : '<span class="fl-st err"><i class="fa-solid fa-xmark"></i> error</span>';
        var total = st && st.status === 'ok' && s.measure ? flSum(st.rows, s.measure) : null;
        return '<div class="fl-node' + (FL.stepSel === s.key ? ' sel' : '') + (st ? ' ' + st.status : '') + (R && R.stoppedAt === s.key ? ' stop' : '') + '" style="left:' + p.x + 'px;top:' + p.y + 'px;width:' + p.w + 'px;height:' + p.h + 'px;--mod:' + m[1] + '" onclick="flSelStep(\'' + s.key + '\')" title="' + esc(m[0]) + '">' +
            '<div class="fl-node-top"><span class="fl-mod">' + esc(s.module) + '</span><span class="fl-no">' + (i + 1) + '</span></div>' +
            '<div class="fl-node-name">' + esc(s.name) + '</div>' +
            '<div class="fl-node-foot">' + status + (total != null ? '<span class="fl-total" title="Σ ' + esc(s.measure) + '">Σ ' + esc(rpCompact(total)) + '</span>' : '') + '</div></div>';
    }).join('');
    box.innerHTML = svg.join('') + nodes;
}
function flSum(rows, col) {
    var t = 0, any = false;
    rows.forEach(function (r) { var v = r[col]; if (typeof v === 'number') { t += v; any = true; } else if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) { t += +v; any = true; } });
    return any ? t : null;
}
/** Headline figures: {label, step, column} sums; {label, expr} over earlier labels. */
function flFigures() {
    var F = FL.flow, R = FL.run; if (!F || !R || !R.done) return [];
    var vals = {}, out = [];
    (F.summary || []).forEach(function (x) {
        var v = null;
        if (x.expr) {
            var e = String(x.expr), ok = true;
            Object.keys(vals).sort(function (a, b) { return b.length - a.length; }).forEach(function (k) {
                e = e.split(k).join(vals[k] == null ? 'NaN' : '(' + vals[k] + ')');
            });
            if (/^[\d\s.+\-*/()eENaN]+$/.test(e)) { try { v = Function('return (' + e + ')')(); } catch (er) { ok = false; } } else ok = false;
            if (!ok || !isFinite(v)) v = null;
        } else {
            var st = R.st[String(x.step || '').toUpperCase()];
            // a stage with no data gives "—", never 0: a missing COGS must not show a 100% margin
            v = st && st.rows && st.rows.length ? flSum(st.rows, String(x.column || '').toUpperCase()) : null;
        }
        vals[x.label] = v;
        out.push({ label: x.label, value: v, fmt: x.fmt });
    });
    return out;
}
function flFmtFig(f) { return f.value == null ? '—' : f.fmt === 'pct' ? f.value.toFixed(1) + '%' : rpNum(f.value); }
function flSummaryStrip() {
    var figs = flFigures(); if (!figs.length) return '';
    return '<div class="fl-figs">' + figs.map(function (f) {
        return '<div class="fl-fig' + (f.value != null && f.value < 0 ? ' neg' : '') + '"><span>' + esc(f.label) + '</span><b>' + esc(flFmtFig(f)) + '</b></div>';
    }).join('') + '</div>';
}

// ── step detail ────────────────────────────────────────────────
function flSelStep(k) { FL.stepSel = k; flRenderDiagram(); flRenderStep(); }
function flStepTab(t) { FL.stepTab = t; flRenderStep(); }
function flRenderStep() {
    var el = $('fl-step'); if (!el || !FL.flow) return;
    var F = FL.flow, s = F.steps.filter(function (x) { return x.key === FL.stepSel; })[0];
    if (!s) { el.innerHTML = '<div class="fs-muted" style="padding:12px;">Click a step in the diagram.</div>'; return; }
    var st = FL.run && FL.run.st[s.key], m = flMod(s.module), idx = F.steps.indexOf(s);
    var tabs = ['data', 'sql', 'keys'].map(function (t) {
        return '<button class="fs-subtab' + (FL.stepTab === t ? ' active' : '') + '" onclick="flStepTab(\'' + t + '\')">' +
            (t === 'data' ? '<i class="fa-solid fa-table"></i> Data' + (st && st.rows ? ' <span class="fs-badge muted">' + st.rows.length + '</span>' : '') : t === 'sql' ? '<i class="fa-solid fa-code"></i> SQL' : '<i class="fa-solid fa-key"></i> Keys') + '</button>';
    }).join('');
    var body = '';
    if (FL.stepTab === 'data') {
        if (!st) body = '<div class="fs-muted fl-pad">Run the flow to see this step\'s rows.</div>';
        else if (st.status === 'error') body = '<div class="fs-error-box" style="margin:10px;">' + esc(st.error) + '</div><div class="fl-pad"><button class="fs-btn ai sm" onclick="flAiFix(\'' + s.key + '\')"><i class="fa-solid fa-wand-magic-sparkles"></i> Ask AI to fix this step</button></div>';
        else if (st.status === 'blocked') body = '<div class="fl-pad fs-muted">Skipped — no values for <b>' + esc(st.missing) + '</b> from the earlier steps.' + (s.hint ? '<br><i class="fa-regular fa-lightbulb"></i> ' + esc(s.hint) : '') + '</div>';
        else if (st.status === 'empty') body = '<div class="fl-pad"><b>0 rows.</b>' + (s.hint ? ' <i class="fa-regular fa-lightbulb"></i> ' + esc(s.hint) : '') + '</div>';
        else if (st.status === 'ok') { body = '<div class="fs-grid small fl-grid" id="fl-grid"></div>'; }
        else body = '<div class="fl-pad fs-muted">Waiting…</div>';
    } else if (FL.stepTab === 'sql') {
        body = '<div class="fl-pad"><div class="fl-sql-label">Saved SQL</div><pre class="fl-sql">' + esc(s.sql) + '</pre>' +
            (st && st.sql ? '<div class="fl-sql-label">As run (keys filled in)</div><pre class="fl-sql run">' + esc(st.sql) + '</pre>' : '') + '</div>';
    } else {
        var parents = s.parents.map(function (p) { var x = F.steps.filter(function (y) { return y.key === p; })[0]; return x ? x.name : p; });
        var uses = flTokens(s.sql).map(function (t) { return t.name + (t.str ? ' (text)' : ''); });
        body = '<div class="fl-pad"><table class="ds-cols"><tbody>' +
            '<tr><th>Follows</th><td>' + (parents.length ? parents.map(esc).join(', ') : '<span class="fs-muted">— first step</span>') + '</td></tr>' +
            '<tr><th>Uses</th><td>' + (uses.length ? uses.map(function (u) { return '<code>' + esc(u) + '</code>'; }).join(' ') : '—') + '</td></tr>' +
            '<tr><th>Hands on</th><td>' + (s.outputs.length ? s.outputs.map(function (o) {
                var v = FL.run && FL.run.keys[o]; return '<code>' + esc(o) + '</code>' + (v ? ' <span class="fs-muted">' + v.list.length + ' value' + (v.list.length === 1 ? '' : 's') + (v.list.length ? ': ' + esc(v.list.slice(0, 6).join(', ')) + (v.list.length > 6 ? '…' : '') : '') + '</span>' : '');
            }).join('<br>') : '—') + '</td></tr>' +
            (s.measure ? '<tr><th>Total of</th><td><code>' + esc(s.measure) + '</code></td></tr>' : '') +
            (s.hint ? '<tr><th>If empty</th><td>' + esc(s.hint) + '</td></tr>' : '') + '</tbody></table></div>';
    }
    el.innerHTML = '<div class="fl-step-head"><span class="fl-mod big" style="--mod:' + m[1] + '">' + esc(s.module) + '</span>' +
        '<div style="min-width:0;flex:1;"><div class="fl-step-name">' + (idx + 1) + '. ' + esc(s.name) + '</div><div class="fs-muted" style="font-size:.72rem;">' + esc(m[0]) + (st && st.ms != null ? ' · ' + fmtMs(st.ms) : '') + '</div></div>' +
        '<button class="fs-btn sm" onclick="flEditStep(\'' + s.key + '\')"><i class="fa-solid fa-pen"></i> Edit</button>' +
        '<button class="fs-btn sm" onclick="flOpenInBuilder(\'' + s.key + '\')" title="Open the SQL (keys filled in when the flow has run) in the SQL Builder"><i class="fa-solid fa-code"></i> SQL Builder</button>' +
        '<button class="fs-btn sm ai" onclick="flAiFix(\'' + s.key + '\')"><i class="fa-solid fa-wand-magic-sparkles"></i> Ask AI</button>' +
        '<button class="fs-icon-btn" title="Move earlier" onclick="flMoveStep(\'' + s.key + '\',-1)"><i class="fa-solid fa-arrow-up"></i></button>' +
        '<button class="fs-icon-btn" title="Move later" onclick="flMoveStep(\'' + s.key + '\',1)"><i class="fa-solid fa-arrow-down"></i></button>' +
        '<button class="fs-icon-btn" title="Delete step" onclick="flDeleteStep(\'' + s.key + '\')"><i class="fa-regular fa-trash-can"></i></button></div>' +
        '<div class="fs-subtabs fl-subtabs">' + tabs + '</div>' + body;
    if (FL.stepTab === 'data' && st && st.status === 'ok') renderSimpleGrid($('fl-grid'), st.cols, st.rows);
}

// ── run engine ─────────────────────────────────────────────────
/** {{NAME}} / {{NAME:str}} tokens in code (not in strings/comments). */
function flTokens(sql) {
    var out = [], seen = {};
    splitSql(sql).forEach(function (seg) {
        if (!seg.code) return;
        var re = /\{\{\s*([A-Za-z_]\w*)\s*(?::\s*(str|num))?\s*\}\}/g, m;
        while ((m = re.exec(seg.text))) { var k = m[1].toUpperCase() + (m[2] || ''); if (!seen[k]) { seen[k] = 1; out.push({ name: m[1].toUpperCase(), str: m[2] === 'str' }); } }
    });
    return out;
}
function flKeyList(vals, asStr) {
    return vals.slice(0, FL_MAX_KEYS).map(function (v) {
        return !asStr && /^-?\d+(\.\d+)?$/.test(String(v)) ? String(v) : lit(String(v));
    }).join(', ');
}
/** Fills key tokens from earlier steps, then flow parameters. → { sql } or { missing } */
function flResolve(sql, keys, params, paramNames) {
    var missing = null;
    var text = splitSql(sql).map(function (seg) {
        if (!seg.code) return seg.text;
        return seg.text.replace(/\{\{\s*([A-Za-z_]\w*)\s*(?::\s*(str|num))?\s*\}\}/g, function (all, name, kind) {
            var up = name.toUpperCase();
            if (paramNames[up] && !kind) return all;                // flow parameter → substituteParams below
            var k = keys[up];
            if (!k || !k.list.length) { missing = missing || up; return 'NULL'; }
            return flKeyList(k.list, kind === 'str');
        });
    }).join('');
    if (missing) return { missing: missing };
    return { sql: substituteParams(text, params) };
}
function flRun(paramsOverride) {
    var F = FL.flow; if (!F || (FL.run && !FL.run.done)) return;
    if (!F.steps.length) { toast('This flow has no steps yet', 'warn'); return; }
    var params = paramsOverride || {}, paramNames = {};
    if (!paramsOverride) document.querySelectorAll('.fl-runbar input[data-p]').forEach(function (i) { params[i.dataset.p] = i.value.trim(); });
    F.params.forEach(function (p) { paramNames[p.name.toUpperCase()] = 1; });
    var empty = F.params.filter(function (p) { return !String(params[p.name] || '').trim(); })[0];
    if (empty) { toast('Enter ' + (empty.label || empty.name) + ' first', 'warn'); var inp = document.querySelector('.fl-runbar input[data-p="' + empty.name + '"]'); if (inp) inp.focus(); return; }
    lsSet('fusionSql.flowParams.' + F.id, params);
    var limit = Math.max(1, Math.min(5000, parseInt(($('fl-limit') || {}).value, 10) || 500));
    lsSet('fusionSql.flowLimit', limit);
    var order = flOrder(F.steps), t0 = Date.now();
    var R = FL.run = { flowId: F.id, params: params, st: {}, keys: {}, done: false, stoppedAt: null, stop: false, limit: limit };
    F.steps.forEach(function (s) { R.st[s.key] = { status: 'pending' }; });
    flRenderMain();
    var next = function (i) {
        if (FL.run !== R) return Promise.resolve();                       // another flow was selected
        if (i >= order.length || R.stop) return Promise.resolve();
        var s = order[i], st = R.st[s.key];
        var res = flResolve(s.sql, R.keys, params, paramNames);
        if (res.missing) { st.status = 'blocked'; st.missing = res.missing; flProgress(s.key); return next(i + 1); }
        st.status = 'running'; st.sql = res.sql; flProgress(s.key);
        var ts = Date.now();
        return fsql(res.sql, limit).then(function (r) {
            st.ms = Date.now() - ts; st.rows = r.rows || []; st.cols = r.columns || []; st.capped = !!r.capped;
            st.status = st.rows.length ? 'ok' : 'empty';
            s.outputs.forEach(function (o) {
                var k = R.keys[o] = R.keys[o] || { list: [], seen: {} };
                st.rows.forEach(function (row) {
                    var v = row[o]; if (v === undefined) { var hit = Object.keys(row).filter(function (c) { return c.toUpperCase() === o; })[0]; v = hit ? row[hit] : undefined; }
                    if (v === undefined || v === null || v === '') return;
                    var key = String(v); if (!k.seen[key]) { k.seen[key] = 1; k.list.push(v); }
                });
            });
        }).catch(function (e) { st.ms = Date.now() - ts; st.status = 'error'; st.error = String(e); })
            .then(function () { flProgress(s.key); return next(i + 1); });
    };
    next(0).then(function () {
        if (FL.run !== R) return;
        R.done = true; R.ms = Date.now() - t0;
        var stop = order.filter(function (s) { return /empty|blocked|error/.test(R.st[s.key].status); })[0];
        R.stoppedAt = stop ? stop.key : null;
        if (R.stop) R.stoppedAt = R.stoppedAt || order.filter(function (s) { return R.st[s.key].status === 'pending'; }).map(function (s) { return s.key; })[0] || null;
        if (stop && !FL.stepSel) FL.stepSel = stop.key;
        if (stop) FL.stepSel = stop.key;
        flRenderMain();
        flRecordRun(R);
        toast(R.stoppedAt ? 'Flow ran — stops at "' + (F.steps.filter(function (x) { return x.key === R.stoppedAt; })[0] || {}).name + '"' : 'Flow complete — every step has data', R.stoppedAt ? 'warn' : 'ok');
    });
}
function flProgress(key) {
    if (FL.stepSel === key || !FL.stepSel) FL.stepSel = key;
    var bn = document.querySelector('.fl-head .fl-banner');
    var html = flStatusBanner();
    if (bn) bn.outerHTML = html; else { var h = document.querySelector('.fl-head'); if (h) h.insertAdjacentHTML('beforeend', html); }
    flRenderDiagram(); flRenderStep();
}
function flRecordRun(R) {
    var F = FL.flow, counts = {};
    F.steps.forEach(function (s) { var st = R.st[s.key]; counts[s.key] = st.status === 'ok' ? st.rows.length : st.status; });
    var stopName = R.stoppedAt ? (F.steps.filter(function (x) { return x.key === R.stoppedAt; })[0] || {}).name : null;
    dbWrite('INSERT INTO ' + FL_R + ' (flow_id, params_json, instance, run_by, run_date, status, stopped_at, step_counts, elapsed_ms) VALUES (' +
        parseInt(F.id, 10) + ', ' + vlit(JSON.stringify(R.params), 2000) + ', ' + vlit(currentInstance(), 10) + ', ' + vlit(appUserName(), 120) + ', SYSDATE, ' +
        vlit(R.stoppedAt ? 'STOPPED' : 'COMPLETE', 20) + ', ' + vlit(stopName || '', 300) + ', ' + vlit(JSON.stringify(counts), 4000) + ', ' + (R.ms || 0) + ')')
        .then(function () {
            FL.runs.unshift({ params: R.params, by: appUserName(), status: R.stoppedAt ? 'STOPPED' : 'COMPLETE', stoppedAt: stopName, date: new Date().toISOString().slice(0, 16).replace('T', ' ') });
            FL.runs = FL.runs.slice(0, 10);
            var f = FL.list.filter(function (x) { return String(x.id) === String(F.id); })[0]; if (f) f.lastRun = new Date().toISOString().slice(0, 16).replace('T', ' ');
            flRenderList();
        }).catch(function () { });
}
function flRerun(i) {
    var r = FL.runs[i]; if (!r) return;
    document.querySelectorAll('.fl-runbar input[data-p]').forEach(function (inp) { if (r.params[inp.dataset.p] != null) inp.value = r.params[inp.dataset.p]; });
    flRun();
}
function flOpenInBuilder(key) {
    var s = FL.flow.steps.filter(function (x) { return x.key === key; })[0]; if (!s) return;
    var st = FL.run && FL.run.st[key];
    setCurrentQuery(null); setSql(st && st.sql ? st.sql : s.sql); showTab('builder');
    toast(st && st.sql ? 'Step SQL with the keys from the last run' : 'Step SQL — run the flow first to fill in the keys');
}

// ── editing ────────────────────────────────────────────────────
function flModuleOptions(sel) {
    return Object.keys(FL_MODULES).map(function (k) { return '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>' + k + ' — ' + FL_MODULES[k][0] + '</option>'; }).join('');
}
function flPersist(F, msg) {
    return flSave(F).then(function (id) {
        toast(msg || 'Flow saved');
        var keepRun = FL.run && FL.run.done ? FL.run : null, keepSel = FL.stepSel;
        return flLoadList().then(function () { return flSelect(id); }).then(function () {
            if (keepRun && FL.flow && String(FL.flow.id) === String(id)) { FL.run = keepRun; FL.stepSel = keepSel; flRenderMain(); }
        });
    }).catch(function (e) { toast('Save failed: ' + e, 'err'); throw e; });
}
function flEditStep(key) {
    var F = FL.flow; if (!F) return;
    var s = key ? F.steps.filter(function (x) { return x.key === key; })[0] : null;
    var isNew = !s;
    if (isNew) {
        var n = 1; while (F.steps.some(function (x) { return x.key === 'S' + n; })) n++;
        var last = F.steps[F.steps.length - 1];
        s = { key: 'S' + n, name: '', module: last ? last.module : 'OTHER', parents: last ? [last.key] : [], outputs: [], measure: '', hint: '', sql: '' };
    }
    var avail = {};
    F.steps.forEach(function (x) { if (x.key !== s.key) x.outputs.forEach(function (o) { avail[o] = 1; }); });
    openModal(isNew ? 'Add step' : 'Edit step — ' + s.name,
        '<div class="fs-form fl-form">' +
        '<div class="fl-form-row"><div><label>Step name</label><input id="fe-name" maxlength="200" value="' + esc(s.name) + '" placeholder="e.g. AR invoice"></div>' +
        '<div style="max-width:220px;"><label>Module</label><select id="fe-mod">' + flModuleOptions(s.module) + '</select></div></div>' +
        '<label>Follows (diagram arrows)</label><div class="fl-checks">' + (F.steps.filter(function (x) { return x.key !== s.key; }).map(function (x) {
            return '<label><input type="checkbox" value="' + x.key + '"' + (s.parents.indexOf(x.key) >= 0 ? ' checked' : '') + '> ' + esc(x.name) + '</label>';
        }).join('') || '<span class="fs-muted">— first step</span>') + '</div>' +
        '<label>SQL <small>use <code>{{KEY}}</code> for keys from earlier steps' + (Object.keys(avail).length ? ' (' + Object.keys(avail).map(function (k) { return '<code>' + esc(k) + '</code>'; }).join(' ') + ')' : '') +
        ', <code>{{KEY:str}}</code> for text columns, and flow parameters like ' + (F.params.map(function (p) { return '<code>{{' + esc(p.name) + '}}</code>'; }).join(' ') || '<code>{{P_...}}</code>') + '</small></label>' +
        '<textarea id="fe-sql" class="fs-db-sql fl-sql-edit" spellcheck="false">' + esc(s.sql) + '</textarea>' +
        '<div class="fl-form-row"><div><label>Hands on (key columns, comma separated)</label><input id="fe-out" value="' + esc(s.outputs.join(', ')) + '" placeholder="e.g. CUSTOMER_TRX_ID"></div>' +
        '<div><label>Total of column (optional)</label><input id="fe-meas" value="' + esc(s.measure) + '" placeholder="e.g. EXTENDED_AMOUNT"></div></div>' +
        '<label>If this step has no rows, what does it mean?</label><input id="fe-hint" maxlength="1000" value="' + esc(s.hint) + '" placeholder="e.g. Run Import AutoInvoice">' +
        '<div id="fe-test" class="fl-test"></div></div>',
        [{ label: '<i class="fa-solid fa-vial"></i> Test', cls: 'ghost', onClick: function () { flTestStep(s.key); } },
        { label: 'Cancel', cls: 'ghost', onClick: closeModal },
        {
            label: '<i class="fa-solid fa-floppy-disk"></i> Save', cls: 'primary', onClick: function () {
                var ns = {
                    key: s.key, name: $('fe-name').value.trim(), module: $('fe-mod').value, sql: $('fe-sql').value.trim(),
                    parents: Array.prototype.map.call(document.querySelectorAll('.fl-checks input:checked'), function (c) { return c.value; }),
                    outputs: $('fe-out').value.split(',').map(function (x) { return x.trim().toUpperCase(); }).filter(Boolean),
                    measure: $('fe-meas').value.trim().toUpperCase(), hint: $('fe-hint').value.trim()
                };
                if (!ns.name) { toast('Give the step a name', 'warn'); return; }
                if (!/^\s*(SELECT|WITH)\b/i.test(ns.sql)) { toast('The step SQL must be a SELECT', 'warn'); return; }
                var copy = JSON.parse(JSON.stringify(F));
                if (isNew) copy.steps.push(ns); else copy.steps = copy.steps.map(function (x) { return x.key === s.key ? ns : x; });
                closeModal(); FL.stepSel = ns.key;
                flPersist(copy, isNew ? 'Step added' : 'Step saved');
            }
        }], true);
    setTimeout(function () { (isNew ? $('fe-name') : $('fe-sql')).focus(); }, 30);
}
/** Runs the SQL in the editor with keys from the last run (or asks for parameters). */
function flTestStep() {
    var F = FL.flow, sql = $('fe-sql').value.trim(), out = $('fe-test');
    var params = {}, paramNames = {};
    document.querySelectorAll('.fl-runbar input[data-p]').forEach(function (i) { params[i.dataset.p] = i.value.trim(); });
    F.params.forEach(function (p) { paramNames[p.name.toUpperCase()] = 1; });
    var res = flResolve(sql, FL.run ? FL.run.keys : {}, params, paramNames);
    if (res.missing) { out.innerHTML = '<div class="fs-error-box">No values for <b>' + esc(res.missing) + '</b> yet — run the flow first so the earlier steps supply them.</div>'; return; }
    out.innerHTML = '<span class="fs-spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;"></span> Testing…';
    fsql(res.sql, 20).then(function (r) {
        out.innerHTML = '<div class="fl-test-ok"><i class="fa-solid fa-circle-check"></i> ' + (r.rows.length ? r.rows.length + ' row(s) — columns: ' + esc((r.columns || []).join(', ')) : '0 rows (the SQL is valid)') + '</div>';
    }).catch(function (e) { out.innerHTML = '<div class="fs-error-box">' + esc(e) + '</div>'; });
}
function flMoveStep(key, dir) {
    var copy = JSON.parse(JSON.stringify(FL.flow)), i = copy.steps.map(function (x) { return x.key; }).indexOf(key), j = i + dir;
    if (i < 0 || j < 0 || j >= copy.steps.length) return;
    var t = copy.steps[i]; copy.steps[i] = copy.steps[j]; copy.steps[j] = t;
    flPersist(copy, 'Step moved');
}
function flDeleteStep(key) {
    var F = FL.flow, s = F.steps.filter(function (x) { return x.key === key; })[0]; if (!s) return;
    if (F.steps.length === 1) { toast('A flow needs at least one step — delete the flow instead', 'warn'); return; }
    confirmModal('Delete step "' + s.name + '"?', 'Steps that follow it keep their SQL; any key it handed on will have no values.', function () {
        var copy = JSON.parse(JSON.stringify(F));
        copy.steps = copy.steps.filter(function (x) { return x.key !== key; });
        copy.steps.forEach(function (x) { x.parents = x.parents.filter(function (p) { return p !== key; }); });
        FL.stepSel = null; flPersist(copy, 'Step deleted');
    });
}
function flEditFlow(isNew) {
    var F = isNew ? { name: '', description: '', params: [{ name: 'P_DOCUMENT_NUMBER', label: 'Document number' }], summary: [], steps: [] } : FL.flow;
    if (!F) return;
    openModal(isNew ? 'New flow' : 'Edit flow',
        '<div class="fs-form fl-form">' +
        '<label>Flow name</label><input id="ff-name" maxlength="200" value="' + esc(F.name) + '" placeholder="e.g. Order to Cash">' +
        '<label>Description</label><input id="ff-desc" maxlength="2000" value="' + esc(F.description) + '">' +
        '<label>Parameters <small>one per line: <code>P_NAME | Label</code></small></label>' +
        '<textarea id="ff-params" class="fs-db-sql" style="min-height:64px;">' + esc(F.params.map(function (p) { return p.name + ' | ' + (p.label || ''); }).join('\n')) + '</textarea>' +
        '<label>Headline figures <small>one per line: <code>Label = S7.REVENUE_AMOUNT</code> (sum of a step column) or <code>Margin = Revenue - COGS</code>; add <code>%</code> at the end for a percentage</small></label>' +
        '<textarea id="ff-sum" class="fs-db-sql" style="min-height:90px;">' + esc(flSummaryToText(F.summary)) + '</textarea>' +
        (isNew ? '<p class="fs-muted" style="margin-top:8px;">After saving, add steps with <i class="fa-solid fa-plus"></i> — or let AI design the whole flow.</p>' : '') + '</div>',
        [{ label: 'Cancel', cls: 'ghost', onClick: closeModal },
        {
            label: '<i class="fa-solid fa-floppy-disk"></i> Save', cls: 'primary', onClick: function () {
                var name = $('ff-name').value.trim(); if (!name) { toast('Give the flow a name', 'warn'); return; }
                var copy = JSON.parse(JSON.stringify(F));
                copy.name = name; copy.description = $('ff-desc').value.trim();
                copy.params = $('ff-params').value.split('\n').map(function (l) { var p = l.split('|'); return { name: p[0].trim().toUpperCase().replace(/[^A-Z0-9_]/g, ''), label: (p[1] || p[0]).trim() }; }).filter(function (p) { return p.name; });
                copy.summary = flTextToSummary($('ff-sum').value);
                if (isNew) {
                    var p0 = copy.params[0] ? copy.params[0].name : 'P_DOCUMENT_NUMBER';
                    copy.steps = [{ key: 'S1', name: 'First step', module: 'OTHER', parents: [], outputs: [], measure: '', hint: '', sql: "SELECT 'replace me' AS info, {{" + p0 + "}} AS input FROM dual" }];
                } else if (FL.flow && copy.name.toUpperCase() !== FL.flow.name.toUpperCase()) {
                    // renamed: save under the new name, then drop the old record
                    closeModal();
                    var oldId = FL.flow.id;
                    return flSave(copy).then(function (id) {
                        return dbWrite('DELETE FROM ' + FL_S + ' WHERE flow_id = ' + parseInt(oldId, 10)).then(function () { return dbWrite('DELETE FROM ' + FL_T + ' WHERE flow_id = ' + parseInt(oldId, 10)); })
                            .then(function () { toast('Flow renamed'); return flLoadList(); }).then(function () { return flSelect(id); });
                    }).catch(function (e) { toast('Save failed: ' + e, 'err'); });
                }
                closeModal();
                flPersist(copy, isNew ? 'Flow created — add its steps' : 'Flow saved');
            }
        }], true);
    setTimeout(function () { $('ff-name').focus(); }, 30);
}
function flSummaryToText(sum) {
    return (sum || []).map(function (x) { return x.label + ' = ' + (x.expr ? x.expr : (x.step || '') + '.' + (x.column || '')) + (x.fmt === 'pct' ? ' %' : ''); }).join('\n');
}
function flTextToSummary(t) {
    return t.split('\n').map(function (l) {
        var m = /^\s*([^=]+?)\s*=\s*(.+?)\s*$/.exec(l); if (!m) return null;
        var rhs = m[2], pct = /%\s*$/.test(rhs); rhs = rhs.replace(/%\s*$/, '').trim();
        var sc = /^([A-Za-z0-9_]+)\.([A-Za-z0-9_$#]+)$/.exec(rhs);
        var o = sc ? { label: m[1], step: sc[1].toUpperCase(), column: sc[2].toUpperCase() } : { label: m[1], expr: rhs };
        if (pct) o.fmt = 'pct';
        return o;
    }).filter(Boolean);
}
function flDuplicate() {
    var F = FL.flow; if (!F) return;
    var base = F.name + ' (copy)', name = base, n = 2;
    while (FL.list.some(function (f) { return f.name.toUpperCase() === name.toUpperCase(); })) name = base + ' ' + n++;
    var copy = JSON.parse(JSON.stringify(F)); copy.id = null; copy.name = name; copy.source = 'USER';
    flPersist(copy, 'Duplicated as "' + name + '"');
}
function flDelete() {
    var F = FL.flow; if (!F) return;
    confirmModal('Delete flow "' + F.name + '"?', 'Removes the flow, its steps and its run history for everyone.', function () {
        var id = parseInt(F.id, 10);
        dbWrite('DELETE FROM ' + FL_S + ' WHERE flow_id = ' + id)
            .then(function () { return dbWrite('DELETE FROM ' + FL_R + ' WHERE flow_id = ' + id).catch(function () { }); })
            .then(function () { return dbWrite('DELETE FROM ' + FL_T + ' WHERE flow_id = ' + id); })
            .then(function () { toast('Flow deleted'); FL.selId = null; FL.flow = null; FL.run = null; return flLoadList(); })
            .catch(function (e) { toast('Delete failed: ' + e, 'err'); });
    });
}

// ── AI ─────────────────────────────────────────────────────────
var FLOW_AI_GUIDE = [
    '',
    'PROCESS FLOW MODE — the user wants a reusable end-to-end process flow. Design it as a chain of SMALL read-only SELECT steps that follow ONE business document through Fusion.',
    '1. Use your Fusion process knowledge for the end-to-end stages. Examples: Order to Cash = order header → fulfillment lines → shipment → inventory transaction → cost distributions / COGS → AR invoice → revenue distributions → subledger accounting → customer receipts. Procure to Pay = PO → lines/schedules → receipts → receipt accounting → supplier invoice → subledger accounting → payments.',
    '2. Verify every table and join column with your tools (describe_object — call several in one turn) and use only objects that exist in this pod. Test a few key steps with run_query on real sample data if useful, but stay within your research budget.',
    '3. The first step filters by the flow parameter(s), written {{P_NAME}} (e.g. {{P_ORDER_NUMBER}}). Compare VARCHAR2 document numbers with TO_CHAR({{P_NAME}}).',
    '4. Every later step filters ONLY by keys handed on by earlier steps: list the key columns a step hands on in "outputs" (exactly as selected, UPPER CASE) and use them later as IN ({{KEY}}), or IN ({{KEY:str}}) when the target column is VARCHAR2. A later step may also use the flow parameters.',
    '5. Keep each step small and readable: 5–12 useful columns, no SELECT *, and alias the amount columns used for totals (e.g. REVENUE_AMOUNT, COGS_AMOUNT). Always qualify tables with the owner (fusion.).',
    '6. "parents" = the step keys this step follows in the diagram (branches are fine, e.g. costing and invoicing both follow the shipment). "module" is one of OM, WSH, INV, CST, XLA, AR, AP, PO, RCV, GL, OTHER. "hint" = what 0 rows at this step means and which process or check to run. "measure" = one amount column to total on the diagram (optional).',
    '7. "summary" = headline figures for the report: {"label","step","column"} sums a step column; {"label","expr"} computes from earlier labels with + - * / and parentheses; add "fmt":"pct" for percentages (e.g. margin %).',
    'Reply with a short explanation of the stages, then EXACTLY ONE fenced code block tagged flow holding valid JSON (no comments, no trailing commas), e.g.:',
    '```flow',
    '{"name":"Order to Cash","description":"…","params":[{"name":"P_ORDER_NUMBER","label":"Sales order number"}],',
    ' "steps":[{"key":"S1","name":"Sales order","module":"OM","parents":[],"outputs":["HEADER_ID"],"measure":"","hint":"…","sql":"SELECT … WHERE h.order_number = TO_CHAR({{P_ORDER_NUMBER}})"}],',
    ' "summary":[{"label":"Revenue","step":"S7","column":"REVENUE_AMOUNT"},{"label":"COGS","step":"S5","column":"COGS_AMOUNT"},{"label":"Margin","expr":"Revenue - COGS"}]}',
    '```',
    'Put no SQL outside the flow block. Do not ask for a flow name — the app asks the user when saving.'
].join('\n');
var FLOW_FIX_GUIDE = '\n\nFLOW STEP FIX — return the corrected SQL for this single step as ONE ```sql block. Keep the same {{KEY}} / {{KEY:str}} / {{P_...}} placeholders (do not replace them with values), keep the columns it hands on, verify tables/columns with your tools first.';

function flIsFlowQuestion(q) { return /\b(process ?flow|flows?\b|end[- ]to[- ]end|order[- ]to[- ]cash|procure[- ]to[- ]pay|record[- ]to[- ]report|o2c|otc|p2p|r2r)\b/i.test(q); }
function flNewWithAi() {
    FS.ai.flowMode = true; FL.fixTarget = null;
    openAi();
    var q = $('fs-ai-q');
    q.value = 'Design the end-to-end process flow for: ';
    setTimeout(function () { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 60);
    toast('Name the process (e.g. Order to Cash, Procure to Pay, Return to Credit) and press Send');
}
function flAiImprove() {
    var F = FL.flow; if (!F) return;
    FS.ai.flowMode = true; FL.fixTarget = null;
    openAi();
    $('fs-ai-q').value = 'Improve the process flow "' + F.name + '" (add missing stages, fix joins, add useful amounts). Current flow JSON:\n' +
        JSON.stringify({ name: F.name, description: F.description, params: F.params, steps: F.steps, summary: F.summary });
    $('fs-ai-q').focus();
}
function flAiFix(key) {
    var F = FL.flow, s = F.steps.filter(function (x) { return x.key === key; })[0]; if (!s) return;
    var st = FL.run && FL.run.st[key];
    var avail = {}; F.steps.forEach(function (x) { if (x.key !== key) x.outputs.forEach(function (o) { avail[o] = 1; }); });
    FL.fixTarget = { flowId: F.id, stepKey: key };
    FS.ai.flowMode = false; FS.ai.fixMode = true;
    openAi();
    $('fs-ai-q').value = 'Fix step "' + s.name + '" of the process flow "' + F.name + '".' +
        (st && st.status === 'error' ? '\nIt fails with: ' + String(st.error).split('\n')[0].slice(0, 400) : st && st.status === 'empty' ? '\nIt returns 0 rows although the earlier steps found data — check the join.' : '') +
        '\nKeys available from earlier steps: ' + (Object.keys(avail).join(', ') || 'none') + '; flow parameters: ' + F.params.map(function (p) { return p.name; }).join(', ') +
        '.\nIt must hand on: ' + (s.outputs.join(', ') || 'nothing') + '.\nCurrent SQL:\n' + s.sql;
    $('fs-ai-q').focus();
}
/** Used by sendAi: extra instructions for flow design / step fixes. */
function flAiDecorate(q) {
    if (FS.ai.fixMode) { FS.ai.fixMode = false; return q + FLOW_FIX_GUIDE; }
    if (FS.ai.flowMode || flIsFlowQuestion(q)) { FS.ai.flowMode = false; return q + '\n' + FLOW_AI_GUIDE; }
    return q;
}
var _aiFlows = [];
/** Renders a ```flow block from Claude as a card with Save. */
function flRenderAiFlow(jsonText) {
    var f;
    try { f = flNormalize(JSON.parse(jsonText)); } catch (e) {
        return '<div class="fs-error-box">Claude returned a flow that is not valid JSON (' + esc(e.message) + '). Ask it to "return the flow block again".</div><pre class="fl-sql">' + esc(jsonText.slice(0, 3000)) + '</pre>';
    }
    var idx = _aiFlows.push(f) - 1;
    return '<div class="fl-aicard"><div class="fl-aicard-head"><i class="fa-solid fa-diagram-project"></i><div><b>' + esc(f.name || 'New flow') + '</b><small>' + f.steps.length + ' steps · ' + esc(f.params.map(function (p) { return p.name; }).join(', ') || 'no parameters') + '</small></div></div>' +
        '<div class="fl-aichain">' + f.steps.map(function (s, i) {
            return (i ? '<i class="fa-solid fa-chevron-right"></i>' : '') + '<span style="--mod:' + flMod(s.module)[1] + '"><em>' + esc(s.module) + '</em>' + esc(s.name) + '</span>';
        }).join('') + '</div>' +
        '<details><summary>Step SQL</summary>' + f.steps.map(function (s, i) { return '<div class="fl-aistep"><b>' + (i + 1) + '. ' + esc(s.name) + '</b>' + (s.outputs.length ? ' <small>→ ' + esc(s.outputs.join(', ')) + '</small>' : '') + '<pre>' + esc(s.sql) + '</pre></div>'; }).join('') + '</details>' +
        '<div class="bar"><button class="fs-btn sm primary" onclick="flSaveAiFlow(' + idx + ')"><i class="fa-solid fa-floppy-disk"></i> Save flow</button>' +
        '<button class="fs-btn sm" onclick="copyText(JSON.stringify(_aiFlows[' + idx + '], null, 1))"><i class="fa-solid fa-copy"></i> Copy JSON</button></div></div>';
}
function flSaveAiFlow(idx) {
    var f = _aiFlows[idx]; if (!f) return;
    openModal('Save flow', '<div class="fs-form"><label>What should this flow be called?</label><input id="fa-name" maxlength="200" value="' + esc(f.name) + '">' +
        '<p class="fs-muted" style="margin-top:8px;">' + f.steps.length + ' steps and their SQL are saved to <code>WMS_FUSION_FLOWS</code> / <code>WMS_FUSION_FLOW_STEPS</code> in the APEX database. A flow with the same name is replaced.</p></div>',
        [{ label: 'Cancel', cls: 'ghost', onClick: closeModal },
        {
            label: '<i class="fa-solid fa-floppy-disk"></i> Save', cls: 'primary', onClick: function () {
                var name = $('fa-name').value.trim(); if (!name) { toast('Give the flow a name', 'warn'); return; }
                var copy = JSON.parse(JSON.stringify(f)); copy.name = name; copy.source = 'AI';
                this.disabled = true; this.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';
                var btn = this;
                flSave(copy).then(function (id) {
                    closeModal(); closeAi(); showTab('flows'); toast('Flow "' + name + '" saved');
                    return flLoadList().then(function () { return flSelect(id); });
                }).catch(function (e) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save'; toast('Save failed: ' + e, 'err'); });
            }
        }]);
    setTimeout(function () { $('fa-name').select(); }, 30);
}
/** "Use in flow step" on a SQL block while fixing a step. */
function flApplyFix(sqlIdx) {
    var T = FL.fixTarget, sql = _aiBlocks[sqlIdx];
    if (!T || !FL.flow || String(FL.flow.id) !== String(T.flowId)) { toast('Open the flow again, then retry', 'warn'); return; }
    var copy = JSON.parse(JSON.stringify(FL.flow));
    copy.steps.forEach(function (s) { if (s.key === T.stepKey) s.sql = sql.trim().replace(/;\s*$/, ''); });
    closeAi(); showTab('flows'); FL.stepSel = T.stepKey; FL.fixTarget = null;
    flPersist(copy, 'Step updated — run the flow again to check it');
}

// ── Flow report ────────────────────────────────────────────────
function flReportModel() {
    var F = FL.flow, R = FL.run;
    return {
        title: F.name, flow: F, run: R, figures: flFigures(),
        subtitle: [Object.keys(R.params).map(function (k) { return k + ' = ' + R.params[k]; }).join(', '),
            FS.status ? FS.status.instance + ' · ' + FS.status.pod : '', 'run ' + new Date().toLocaleString() + ' by ' + appUserName()].filter(Boolean).join('  ·  '),
        steps: F.steps.map(function (s, i) { var st = R.st[s.key] || {}; return { no: i + 1, s: s, st: st, rows: st.rows || [], cols: st.cols || [] }; })
    };
}
function flStatusText(st) {
    return st.status === 'ok' ? st.rows.length + ' rows' : st.status === 'empty' ? '0 rows' : st.status === 'blocked' ? 'no input (' + (st.missing || '') + ')' : st.status === 'error' ? 'error' : 'not run';
}
function flOpenReport() {
    if (!FL.run || !FL.run.done) { toast('Run the flow first', 'warn'); return; }
    var M = flReportModel(), R = M.run, F = M.flow;
    var ov = $('rp-overlay');
    if (!ov) { ov = document.createElement('div'); ov.id = 'rp-overlay'; ov.className = 'rp-overlay'; ov.addEventListener('mousedown', function (e) { if (e.target === ov) closeReport(); }); document.body.appendChild(ov); }
    var stop = R.stoppedAt ? F.steps.filter(function (x) { return x.key === R.stoppedAt; })[0] : null;
    ov.innerHTML = '<div class="rp-shell"><div class="rp-top"><div class="rp-brand"><i class="fa-solid fa-diagram-project"></i></div>' +
        '<div class="rp-title-input" style="border:0;">' + esc(M.title) + ' — flow report</div><div class="rp-top-actions">' +
        '<div class="rp-dd"><button class="fs-btn sm" onclick="rpMenu(\'fl-exp\', event)"><i class="fa-solid fa-download"></i> Export <i class="fa-solid fa-caret-down"></i></button><div class="rp-menu" id="fl-exp">' +
        '<button onclick="flExportExcel()"><i class="fa-solid fa-file-excel" style="color:#16a34a"></i><span><b>Excel workbook</b><small>Summary + one sheet per step</small></span></button>' +
        '<button onclick="flExportPdf()"><i class="fa-solid fa-file-pdf" style="color:#dc2626"></i><span><b>PDF report</b><small>Figures, stages and data</small></span></button>' +
        '<button onclick="flExportHtml()"><i class="fa-solid fa-file-code" style="color:#2563eb"></i><span><b>HTML report</b><small>One file — opens in any browser</small></span></button></div></div>' +
        '<div class="rp-dd"><button class="fs-btn sm primary" onclick="rpMenu(\'fl-share\', event)"><i class="fa-solid fa-share-nodes"></i> Share <i class="fa-solid fa-caret-down"></i></button><div class="rp-menu" id="fl-share">' +
        '<button onclick="flShareOutlook()"><i class="fa-solid fa-envelope" style="color:#2563eb"></i><span><b>Email via Outlook</b><small>Draft with the report + Excel attached</small></span></button>' +
        '<button onclick="flCopyRich()"><i class="fa-solid fa-clipboard" style="color:#c74634"></i><span><b>Copy for email / Teams</b><small>Paste as a formatted report</small></span></button></div></div>' +
        '<button class="fs-icon-btn rp-close" onclick="closeReport()" title="Close (Esc)"><i class="fa-solid fa-xmark"></i></button></div></div>' +
        '<div class="rp-body">' +
        '<div class="rp-hero"><h1>' + esc(M.title) + '</h1><p>' + esc(M.subtitle) + '</p></div>' +
        (stop ? '<div class="fl-banner stop"><i class="fa-solid fa-triangle-exclamation"></i><div><b>The flow stops at "' + esc(stop.name) + '"</b>' + (stop.hint ? '<br><span class="fl-hint">' + esc(stop.hint) + '</span>' : '') + '</div></div>'
            : '<div class="fl-banner ok"><i class="fa-solid fa-circle-check"></i> Complete — every stage has data.</div>') +
        (M.figures.length ? '<div class="rp-kpis">' + M.figures.map(function (f) { return '<div class="rp-kpi' + (/margin/i.test(f.label) ? ' accent' : '') + '"><span>' + esc(f.label) + '</span><b>' + esc(flFmtFig(f)) + '</b></div>'; }).join('') + '</div>' : '') +
        '<div class="rp-card"><h3><i class="fa-solid fa-route"></i> Stages</h3><div class="fl-timeline">' + M.steps.map(function (x) {
            var cls = x.st.status || 'idle'; var tot = x.s.measure && x.rows.length ? flSum(x.rows, x.s.measure) : null;
            return '<div class="fl-tl ' + cls + '" style="--mod:' + flMod(x.s.module)[1] + '"><span class="fl-mod">' + esc(x.s.module) + '</span><b>' + x.no + '. ' + esc(x.s.name) + '</b><em>' + esc(flStatusText(x.st)) + (tot != null ? ' · Σ ' + esc(rpNum(tot)) : '') + '</em></div>';
        }).join('') + '</div></div>' +
        M.steps.filter(function (x) { return x.rows.length; }).map(function (x) {
            return '<div class="rp-card"><h3><span class="fl-mod" style="--mod:' + flMod(x.s.module)[1] + '">' + esc(x.s.module) + '</span> ' + x.no + '. ' + esc(x.s.name) + ' <small>' + x.rows.length + ' rows</small></h3>' +
                '<div class="rp-table-wrap short"><table class="rp-table"><thead><tr>' + x.cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
                x.rows.slice(0, 200).map(function (r) { return '<tr>' + x.cols.map(function (c) { var v = r[c]; return '<td class="' + (typeof v === 'number' ? 'n' : '') + '">' + (v == null || v === '' ? '<span class="nul">—</span>' : esc(typeof v === 'number' && !/_ID$|NUMBER$/.test(c) ? rpNum(v) : v)) + '</td>'; }).join('') + '</tr>'; }).join('') +
                '</tbody></table></div></div>';
        }).join('') + '</div></div>';
    ov.classList.add('open');
    document.addEventListener('keydown', rpKey);
}
function flFileName(ext) { return (FL.flow.name + '_' + (Object.keys(FL.run.params).map(function (k) { return FL.run.params[k]; }).join('_'))).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60) + '_' + nowStamp() + '.' + ext; }
function flBuildExcel() {
    var M = flReportModel();
    var wb = new ExcelJS.Workbook(); wb.creator = "Gray's WMS — Fusion SQL";
    var red = 'FFC74634';
    var sh = wb.addWorksheet('Summary', { views: [{ showGridLines: false }] });
    sh.columns = [{ width: 4 }, { width: 34 }, { width: 14 }, { width: 22 }, { width: 60 }];
    sh.getCell('B2').value = M.title; sh.getCell('B2').font = { size: 16, bold: true };
    sh.getCell('B3').value = M.subtitle; sh.getCell('B3').font = { size: 9, color: { argb: 'FF8A817B' } };
    var row = 5;
    M.figures.forEach(function (f) { sh.getCell(row, 2).value = f.label; sh.getCell(row, 2).font = { bold: true }; var c = sh.getCell(row, 3); c.value = f.value; c.numFmt = f.fmt === 'pct' ? '0.0"%"' : '#,##0.00'; row++; });
    row++;
    ['Step', 'Module', 'Result', 'If empty'].forEach(function (t, i) { var c = sh.getCell(row, 2 + i); c.value = t; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: red } }; });
    M.steps.forEach(function (x) {
        row++;
        sh.getCell(row, 2).value = x.no + '. ' + x.s.name; sh.getCell(row, 3).value = x.s.module; sh.getCell(row, 4).value = flStatusText(x.st);
        sh.getCell(row, 5).value = x.st.status === 'ok' ? '' : x.s.hint;
        if (x.st.status !== 'ok') sh.getCell(row, 4).font = { color: { argb: x.st.status === 'error' ? 'FFB91C1C' : 'FFB45309' }, bold: true };
    });
    var used = {};
    M.steps.forEach(function (x) {
        if (!x.rows.length) return;
        var nm = (x.no + ' ' + x.s.name).replace(/[\\\/\?\*\[\]:]/g, ' ').slice(0, 31), k = 2; while (used[nm]) nm = nm.slice(0, 28) + ' ' + k++; used[nm] = 1;
        var ws = wb.addWorksheet(nm, { views: [{ state: 'frozen', ySplit: 1 }] });
        ws.columns = x.cols.map(function (c) { return { header: c, key: c, width: Math.max(10, Math.min(40, c.length + 4)) }; });
        x.rows.forEach(function (r) { var o = {}; x.cols.forEach(function (c) { o[c] = r[c] === '' ? null : r[c]; }); ws.addRow(o); });
        ws.getRow(1).eachCell(function (c) { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: red } }; });
        ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: x.cols.length } };
    });
    return wb.xlsx.writeBuffer();
}
function flExportExcel() {
    rpMenu(null);
    if (typeof ExcelJS === 'undefined') { toast('Excel library not loaded (offline?)', 'err'); return; }
    flBuildExcel().then(function (buf) { downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), flFileName('xlsx')); toast('Flow report exported'); });
}
function flExportPdf() {
    rpMenu(null);
    if (!window.jspdf) { toast('PDF library not loaded (offline?)', 'err'); return; }
    var M = flReportModel(), doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' }), W = doc.internal.pageSize.getWidth();
    doc.setFillColor(49, 45, 42); doc.rect(0, 0, W, 58, 'F'); doc.setFillColor(199, 70, 52); doc.rect(0, 58, W, 3, 'F');
    doc.setTextColor(255); doc.setFontSize(17); doc.text(M.title + ' — flow report', 32, 30);
    doc.setFontSize(8); doc.setTextColor(210, 204, 199); doc.text(M.subtitle, 32, 46);
    var head = { fillColor: [199, 70, 52], textColor: 255, fontStyle: 'bold' };
    doc.autoTable({ startY: 76, head: [['Figure', 'Value']], body: M.figures.map(function (f) { return [f.label, flFmtFig(f)]; }), styles: { fontSize: 9 }, headStyles: head, margin: { left: 32 }, tableWidth: 260 });
    doc.autoTable({ startY: doc.lastAutoTable.finalY + 14, head: [['#', 'Step', 'Module', 'Result', 'If empty']], body: M.steps.map(function (x) { return [x.no, x.s.name, x.s.module, flStatusText(x.st), x.st.status === 'ok' ? '' : x.s.hint]; }), styles: { fontSize: 8 }, headStyles: head, margin: { left: 32, right: 32 } });
    M.steps.forEach(function (x) {
        if (!x.rows.length) return;
        doc.addPage(); doc.setFontSize(11); doc.setTextColor(49, 45, 42); doc.text(x.no + '. ' + x.s.name + ' (' + x.s.module + ') — ' + x.rows.length + ' rows', 24, 30);
        doc.autoTable({ startY: 40, head: [x.cols], body: x.rows.slice(0, 1000).map(function (r) { return x.cols.map(function (c) { return r[c] == null ? '' : String(r[c]); }); }), styles: { fontSize: x.cols.length > 10 ? 5.5 : 7, cellPadding: 2 }, headStyles: head, margin: { left: 24, right: 24 } });
    });
    doc.save(flFileName('pdf'));
}
function flReportHtml(maxRows) {
    var M = flReportModel(), f = 'font-family:Segoe UI,Arial,sans-serif;';
    var th = 'style="' + f + 'background:#c74634;color:#fff;font-size:11px;text-align:left;padding:5px 8px;"';
    var td = 'style="' + f + 'font-size:11px;padding:4px 8px;border:1px solid #ece8e4;"';
    var h = ['<div style="' + f + 'color:#2b2623;max-width:1100px;">',
        '<div style="background:#312d2a;border-bottom:3px solid #c74634;padding:14px 18px;border-radius:8px 8px 0 0;"><div style="font-size:19px;font-weight:700;color:#fff;">' + esc(M.title) + ' — flow report</div><div style="font-size:11px;color:#d2ccc7;">' + esc(M.subtitle) + '</div></div>'];
    if (M.figures.length) h.push('<table cellspacing="8"><tr>' + M.figures.map(function (x) { return '<td style="' + f + 'background:#faf8f7;border:1px solid #e7e2de;border-radius:8px;padding:8px 12px;"><div style="font-size:10px;color:#8a817b;font-weight:700;text-transform:uppercase;">' + esc(x.label) + '</div><div style="font-size:20px;font-weight:700;">' + esc(flFmtFig(x)) + '</div></td>'; }).join('') + '</tr></table>');
    h.push('<table cellspacing="0" style="border-collapse:collapse;margin:8px 0 14px;"><tr><th ' + th + '>Step</th><th ' + th + '>Module</th><th ' + th + '>Result</th><th ' + th + '>If empty</th></tr>' + M.steps.map(function (x) {
        var col = x.st.status === 'ok' ? '#15803d' : x.st.status === 'error' ? '#b91c1c' : '#b45309';
        return '<tr><td ' + td + '>' + x.no + '. ' + esc(x.s.name) + '</td><td ' + td + '>' + esc(x.s.module) + '</td><td ' + td.replace('"', '"color:' + col + ';font-weight:700;') + '>' + esc(flStatusText(x.st)) + '</td><td ' + td + '>' + (x.st.status === 'ok' ? '' : esc(x.s.hint)) + '</td></tr>';
    }).join('') + '</table>');
    M.steps.forEach(function (x) {
        if (!x.rows.length) return;
        h.push('<div style="font-size:13px;font-weight:700;margin:12px 0 4px;">' + x.no + '. ' + esc(x.s.name) + ' <span style="font-weight:400;color:#8a817b;font-size:11px;">' + x.rows.length + ' rows</span></div>');
        h.push('<table cellspacing="0" style="border-collapse:collapse;"><tr>' + x.cols.map(function (c) { return '<th ' + th + '>' + esc(c) + '</th>'; }).join('') + '</tr>' +
            x.rows.slice(0, maxRows).map(function (r) { return '<tr>' + x.cols.map(function (c) { return '<td ' + td + '>' + esc(r[c] == null ? '' : r[c]) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table>');
    });
    h.push('<div style="font-size:10px;color:#8a817b;margin-top:12px;">Generated with Gray\'s WMS · Fusion SQL · Flows</div></div>');
    return h.join('');
}
function flExportHtml() {
    rpMenu(null);
    var html = '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(FL.flow.name) + '</title><style>body{margin:0;padding:24px;background:#f4f2f0;}</style></head><body>' + flReportHtml(2000) + '</body></html>';
    downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), flFileName('html'));
}
function flShareOutlook() {
    rpMenu(null);
    var html = flReportHtml(25), atts = [];
    (typeof ExcelJS !== 'undefined' ? flBuildExcel() : Promise.resolve(null)).then(function (buf) {
        if (buf) atts.push({ name: flFileName('xlsx'), base64: rpB64(buf) });
        return fsCall('fusionSqlShareOutlook', { subject: FL.flow.name + ' — ' + Object.keys(FL.run.params).map(function (k) { return FL.run.params[k]; }).join(', '), html: html, attachments: atts });
    }).then(function (r) {
        if (r && r.via === 'outlook') toast('Outlook draft opened — review and send');
        else if (r && r.via === 'folder') toast('Outlook not found — the files are in the folder that just opened', 'warn');
        else toast('Could not prepare the email: ' + ((r && r.error) || 'unknown'), 'err');
    }).catch(function (e) { toast('Email failed: ' + e, 'err'); });
}
function flCopyRich() {
    rpMenu(null);
    var html = flReportHtml(25), M = flReportModel();
    var text = M.title + '\n' + M.subtitle + '\n\n' + M.figures.map(function (f) { return f.label + ': ' + flFmtFig(f); }).join('\n') + '\n\n' + M.steps.map(function (x) { return x.no + '. ' + x.s.name + ' — ' + flStatusText(x.st); }).join('\n');
    if (navigator.clipboard && window.ClipboardItem)
        navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]).then(function () { toast('Flow report copied'); }, function () { copyText(text); });
    else copyText(text);
}

// ── Oracle Fusion flow library (flows-catalog.js) ──────────────
FL.lib = { area: 'ALL', term: '' };
function flCatalog() {
    return (window.FS_FLOW_CATALOG || []).map(function (c, i) {
        return { i: i, area: c[0], name: c[1], param: c[2], label: c[3], description: c[4], stages: c[5], tables: c[6] };
    });
}
function flArea(code) { return (window.FS_FLOW_AREAS || []).filter(function (a) { return a[0] === code; })[0] || [code, code, 'fa-diagram-project', '#57504b']; }
/** A catalog entry counts as built when a saved flow has (roughly) its name. */
function flBuiltFlow(c) {
    var n = c.name.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return FL.list.filter(function (f) { var m = f.name.toUpperCase().replace(/[^A-Z0-9]/g, ''); return m === n || m.indexOf(n) === 0; })[0];
}
function flOpenLibrary() {
    var ov = $('fl-lib');
    if (!ov) {
        ov = document.createElement('div'); ov.id = 'fl-lib'; ov.className = 'rp-overlay';
        ov.addEventListener('mousedown', function (e) { if (e.target === ov) flCloseLibrary(); });
        document.body.appendChild(ov);
    }
    ov.innerHTML = '<div class="rp-shell fl-lib-shell"><div class="rp-top"><div class="rp-brand"><i class="fa-solid fa-book-open"></i></div>' +
        '<div class="rp-title-input" style="border:0;">Oracle Fusion flow library <small class="fl-lib-sub">' + flCatalog().length + ' end-to-end processes — pick one and let AI build it for your pod</small></div>' +
        '<div class="rp-top-actions"><button class="fs-icon-btn rp-close" onclick="flCloseLibrary()" title="Close (Esc)"><i class="fa-solid fa-xmark"></i></button></div></div>' +
        '<div class="rp-controls fl-lib-controls"><div class="ds-side-search" style="padding:0;flex:1;max-width:360px;"><i class="fa-solid fa-magnifying-glass" style="left:11px;"></i>' +
        '<input id="fl-lib-q" placeholder="Search process, stage or table…" value="' + esc(FL.lib.term) + '" oninput="FL.lib.term=this.value;flRenderLibrary()"></div>' +
        '<div class="fl-lib-areas" id="fl-lib-areas"></div></div>' +
        '<div class="rp-body"><div class="fl-lib-grid" id="fl-lib-grid"></div></div></div>';
    ov.classList.add('open');
    document.addEventListener('keydown', flLibKey);
    flRenderLibrary();
    setTimeout(function () { var q = $('fl-lib-q'); if (q) q.focus(); }, 50);
}
function flCloseLibrary() { var ov = $('fl-lib'); if (ov) ov.classList.remove('open'); document.removeEventListener('keydown', flLibKey); }
function flLibKey(e) { if (e.key === 'Escape') flCloseLibrary(); }
function flLibArea(a) { FL.lib.area = a; flRenderLibrary(); }
function flRenderLibrary() {
    var all = flCatalog(), term = FL.lib.term.toLowerCase().trim();
    var match = all.filter(function (c) { return !term || (c.name + ' ' + c.description + ' ' + c.stages.join(' ') + ' ' + c.tables + ' ' + c.label).toLowerCase().indexOf(term) >= 0; });
    var counts = {}; match.forEach(function (c) { counts[c.area] = (counts[c.area] || 0) + 1; });
    $('fl-lib-areas').innerHTML = '<button class="fl-chip' + (FL.lib.area === 'ALL' ? ' on' : '') + '" onclick="flLibArea(\'ALL\')">All <span>' + match.length + '</span></button>' +
        (window.FS_FLOW_AREAS || []).map(function (a) {
            return '<button class="fl-chip' + (FL.lib.area === a[0] ? ' on' : '') + '" style="--area:' + a[3] + '" onclick="flLibArea(\'' + a[0] + '\')"><i class="fa-solid ' + a[2] + '"></i> ' + esc(a[1]) + ' <span>' + (counts[a[0]] || 0) + '</span></button>';
        }).join('');
    var list = match.filter(function (c) { return FL.lib.area === 'ALL' || c.area === FL.lib.area; });
    $('fl-lib-grid').innerHTML = list.map(function (c) {
        var a = flArea(c.area), built = flBuiltFlow(c);
        return '<div class="fl-lib-card" style="--area:' + a[3] + '">' +
            '<div class="fl-lib-head"><span class="fl-lib-area"><i class="fa-solid ' + a[2] + '"></i> ' + esc(a[1]) + '</span>' +
            (built ? '<span class="ds-st ds-st-ok"><i class="fa-solid fa-check"></i> Built</span>' : '') + '</div>' +
            '<h4>' + esc(c.name) + '</h4><p>' + esc(c.description) + '</p>' +
            '<div class="fl-lib-stages">' + c.stages.map(function (s, i) { return (i ? '<i class="fa-solid fa-chevron-right"></i>' : '') + '<span>' + esc(s) + '</span>'; }).join('') + '</div>' +
            '<div class="fl-lib-param"><i class="fa-solid fa-keyboard"></i> Starts from <b>' + esc(c.label) + '</b> <code>' + esc(c.param) + '</code></div>' +
            '<details class="fl-lib-tables"><summary>Key tables</summary><div>' + esc(c.tables) + '</div></details>' +
            '<div class="fl-lib-foot">' +
            (built ? '<button class="fs-btn sm" onclick="flCloseLibrary();showTab(\'flows\');flSelect(' + parseInt(built.id, 10) + ')"><i class="fa-solid fa-eye"></i> Open</button>' : '') +
            '<button class="fs-btn sm ai" onclick="flBuildFromCatalog(' + c.i + ', true)"><i class="fa-solid fa-wand-magic-sparkles"></i> ' + (built ? 'Rebuild with AI' : 'Build with AI') + '</button>' +
            '<button class="fs-btn sm" onclick="flBuildFromCatalog(' + c.i + ', false)" title="Put the request in the Ask AI box so you can adjust it first"><i class="fa-solid fa-pen"></i> Adjust request</button></div></div>';
    }).join('') || '<div class="fs-muted" style="padding:20px;">No process matches “' + esc(term) + '”. You can still describe any process to Ask AI.</div>';
}
/** Opens Ask AI in flow mode with the catalog entry spelled out; send=true submits it right away. */
function flBuildFromCatalog(i, send) {
    var c = flCatalog()[i]; if (!c) return;
    var a = flArea(c.area);
    var q = 'Design the end-to-end process flow "' + c.name + '" (Oracle Fusion ' + a[1] + ').\n' +
        c.description + '\n' +
        'Start from ONE document: flow parameter ' + c.param + ' = ' + c.label + '.\n' +
        'Stages to cover, in this order (drop a stage only if it does not exist in this pod; add one when it is needed to connect the chain):\n' +
        c.stages.map(function (s, n) { return (n + 1) + '. ' + s; }).join('\n') + '\n' +
        'Key tables to consider (verify each one — names can differ by release): ' + c.tables + '.\n' +
        'Name the flow "' + c.name + '".';
    flCloseLibrary();
    FS.ai.flowMode = true; FL.fixTarget = null;
    openAi();
    $('fs-ai-q').value = q;
    if (send) { setTimeout(sendAi, 60); toast('Claude is designing "' + c.name + '" — this takes a minute or two while it checks your pod'); }
    else { $('fs-ai-q').focus(); toast('Adjust the request, then press Send'); }
}
