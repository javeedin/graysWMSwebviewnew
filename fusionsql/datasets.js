/* ═══════════════════════════════════════════════════════════════
   Fusion SQL — APEX Data
   Save a Fusion query result as a table in the APEX database, keep the
   source SQL + parameter values, refresh it later by re-running the
   query, and query the saved tables back.

   Registry  : WMS_FUSION_SQL_DATASETS  (apex_sql/64_fusion_sql_datasets.sql)
   Data      : FSQ_<NAME>  (FSQ_LOAD_ID, FSQ_LOADED_AT, <result columns>)
   Transport : ai/executequery + ai/executewrite (one statement per call),
               through dbRead / dbWrite in fusionsql.js.
   ═══════════════════════════════════════════════════════════════ */

var DS = {
    REG: 'wms_fusion_sql_datasets',
    PREFIX: 'FSQ_',
    state: 'loading',       // loading | ready | missing | offline
    error: null,
    list: [],
    busy: {},               // dataset_id -> progress text
    query: null             // last APEX query result { columns, rows, sql }
};
var DS_BATCH_ROWS = 250, DS_BATCH_CHARS = 150000, DS_TEXT_BYTES = 3900;
var DS_BANNED = /^(GRANT|REVOKE|BEGIN|DECLARE|CALL)$/;       // words the write gateway refuses
var DS_REG_DDL = 'CREATE TABLE ' + 'wms_fusion_sql_datasets' + ' (' +
    'dataset_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, dataset_name VARCHAR2(200) NOT NULL, ' +
    'table_name VARCHAR2(128) NOT NULL, description VARCHAR2(1000), source_sql CLOB NOT NULL, param_json VARCHAR2(4000), ' +
    "row_limit NUMBER, refresh_mode VARCHAR2(10) DEFAULT 'REPLACE', current_load_id NUMBER DEFAULT 0, row_count NUMBER, " +
    'column_count NUMBER, instance VARCHAR2(10), created_by VARCHAR2(120), created_date DATE DEFAULT SYSDATE, ' +
    'refreshed_by VARCHAR2(120), refreshed_date DATE, last_status VARCHAR2(10), last_error VARCHAR2(4000), last_ms NUMBER)';
var DS_REG_INDEXES = [
    'CREATE UNIQUE INDEX wms_fusion_sql_datasets_name_ux ON wms_fusion_sql_datasets (UPPER(dataset_name))',
    'CREATE UNIQUE INDEX wms_fusion_sql_datasets_tab_ux ON wms_fusion_sql_datasets (table_name)'
];

// ── Names & types ──────────────────────────────────────────────
/** Oracle-safe identifier: A-Z0-9_, starts with a letter, not a word the write gateway rejects. */
function dsIdent(s, maxLen) {
    var n = String(s || '').toUpperCase().replace(/[^A-Z0-9_]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    if (!n) n = 'COL';
    if (!/^[A-Z]/.test(n)) n = 'C_' + n;
    if (/^(DBMS_|UTL_)/.test(n)) n = 'X_' + n;
    if (DS_BANNED.test(n)) n += '_COL';
    return n.slice(0, maxLen || 60).replace(/_+$/, '');
}
function dsTableName(name) { return (DS.PREFIX + dsIdent(name, 56)).slice(0, 60); }
function dsQ(id) { return '"' + id + '"'; }
function dsIsNumeric(v) { return typeof v === 'number' || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.replace(/,/g, ''))); }

/** Maps result columns to APEX columns. existing = { NAME: 'NUMBER'|'VARCHAR2' } when the table already exists. */
function dsMapColumns(columns, rows, existing) {
    var used = { FSQ_LOAD_ID: 1, FSQ_LOADED_AT: 1 }, out = [];
    columns.forEach(function (src) {
        var base = dsIdent(src, 56), col = base, k = 2;
        while (used[col]) col = (base.slice(0, 52) + '_' + k++);
        used[col] = 1;
        var type;
        if (existing && existing[col]) type = existing[col];
        else {
            var any = false, num = true;
            for (var i = 0; i < rows.length; i++) {
                var v = rows[i][src];
                if (v === undefined || v === null || v === '') continue;
                any = true;
                if (!dsIsNumeric(v)) { num = false; break; }
            }
            type = any && num ? 'NUMBER' : 'VARCHAR2';
        }
        out.push({ src: src, col: col, type: type, isNew: !!existing && !existing[col] });
    });
    return out;
}
function dsTypeSql(t) { return t === 'NUMBER' ? 'NUMBER' : 'VARCHAR2(4000)'; }

/** Cut to at most n UTF-8 bytes (literal and VARCHAR2(4000) limits are in bytes). */
function dsUtf8Cut(s, n) {
    if (s.length * 3 <= n) return s;
    var enc = new TextEncoder();
    if (enc.encode(s).length <= n) return s;
    var lo = 0, hi = s.length;
    while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (enc.encode(s.slice(0, mid)).length <= n) lo = mid; else hi = mid - 1; }
    return s.slice(0, lo);
}
function dsVal(v, c) {
    if (v === undefined || v === null || v === '') return 'NULL';
    if (c.type === 'NUMBER') {
        var s = String(v).replace(/,/g, '');
        if (!/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(s))
            throw 'Column ' + c.col + ' holds numbers in APEX, but the new data has text ("' + String(v).slice(0, 40) + '"). Use Rebuild to recreate the table.';
        return s;
    }
    return lit(dsUtf8Cut(String(v), DS_TEXT_BYTES));
}

// ── Statement builders ────────────────────────────────────────
function dsCreateTableSql(table, map) {
    return 'CREATE TABLE ' + dsQ(table) + ' (' + dsQ('FSQ_LOAD_ID') + ' NUMBER, ' + dsQ('FSQ_LOADED_AT') + ' DATE DEFAULT SYSDATE' +
        map.map(function (c) { return ', ' + dsQ(c.col) + ' ' + dsTypeSql(c.type); }).join('') + ')';
}
/** INSERT … SELECT … FROM dual UNION ALL … batches (the gateway runs one statement per call). */
function dsInsertStatements(table, map, rows, loadId) {
    var head = 'INSERT INTO ' + dsQ(table) + ' (' + dsQ('FSQ_LOAD_ID') + map.map(function (c) { return ', ' + dsQ(c.col); }).join('') + ') ';
    var stmts = [], parts = [], size = 0;
    rows.forEach(function (r) {
        var sel = 'SELECT ' + loadId + map.map(function (c) { return ', ' + dsVal(r[c.src], c); }).join('') + ' FROM dual';
        if (parts.length && (parts.length >= DS_BATCH_ROWS || size + sel.length > DS_BATCH_CHARS)) {
            stmts.push(head + parts.join(' UNION ALL ')); parts = []; size = 0;
        }
        parts.push(sel); size += sel.length + 11;
    });
    if (parts.length) stmts.push(head + parts.join(' UNION ALL '));
    return stmts;
}

// ── Registry ───────────────────────────────────────────────────
function dsEnsureRegistry() {
    if (DS.state === 'ready') return Promise.resolve();
    return dbRead("SELECT COUNT(*) AS n FROM user_tables WHERE table_name = 'WMS_FUSION_SQL_DATASETS'", 1).then(function (r) {
        if (r.length && +r[0].N > 0) return;
        toast('Creating table WMS_FUSION_SQL_DATASETS…', 'warn');
        return DS_REG_INDEXES.reduce(function (p, ix) { return p.then(function () { return dbWrite(ix); }); }, dbWrite(DS_REG_DDL));
    }).then(function () { DS.state = 'ready'; });
}

function dsLoadList() {
    if (DS.state !== 'ready') DS.state = 'loading';
    dsRenderStatus();
    var pieces = [];
    for (var i = 0; i < SQL_PIECES; i++) pieces.push('TO_CHAR(SUBSTR(source_sql, ' + (i * SQL_PIECE + 1) + ', ' + SQL_PIECE + ')) AS p' + i);
    var sql = 'SELECT dataset_id, dataset_name, table_name, description, param_json, row_limit, refresh_mode, current_load_id, row_count, column_count, ' +
        "instance, created_by, TO_CHAR(created_date, 'YYYY-MM-DD HH24:MI') AS created, refreshed_by, TO_CHAR(refreshed_date, 'YYYY-MM-DD HH24:MI') AS refreshed, " +
        'last_status, last_error, last_ms, ' + pieces.join(', ') + ' FROM ' + DS.REG + ' ORDER BY NVL(refreshed_date, created_date) DESC';
    return dbRead(sql, 1000).then(function (rows) {
        DS.state = 'ready'; DS.error = null;
        DS.list = rows.map(function (r) {
            var text = '';
            for (var i = 0; i < SQL_PIECES; i++) text += r['P' + i] || '';
            var params = {};
            try { params = JSON.parse(r.PARAM_JSON || '{}') || {}; } catch (e) { }
            return {
                id: r.DATASET_ID, name: r.DATASET_NAME, table: r.TABLE_NAME, description: r.DESCRIPTION || '', sql: text, params: params,
                rowLimit: r.ROW_LIMIT || 1000, mode: r.REFRESH_MODE || 'REPLACE', loadId: +r.CURRENT_LOAD_ID || 0,
                rows: r.ROW_COUNT, cols: r.COLUMN_COUNT, instance: r.INSTANCE, createdBy: r.CREATED_BY, created: r.CREATED,
                refreshedBy: r.REFRESHED_BY, refreshed: r.REFRESHED, status: r.LAST_STATUS, error: r.LAST_ERROR, ms: r.LAST_MS
            };
        });
    }).catch(function (e) {
        DS.error = String(e);
        DS.state = /ORA-00942|table or view does not exist/i.test(DS.error) ? 'missing' : 'offline';
        DS.list = [];
    }).then(function () {
        var b = $('fs-ds-count');
        if (b) { b.textContent = DS.list.length; b.classList.toggle('muted', !DS.list.length); }
        dsRenderStatus(); dsRenderList();
        return DS.list;
    });
}
function dsFind(id) { return DS.list.filter(function (d) { return d.id === id; })[0]; }
function dsRegUpdate(id, sets) { return dbWrite('UPDATE ' + DS.REG + ' SET ' + sets + ' WHERE dataset_id = ' + parseInt(id, 10)); }
function dsTableColumns(table) {
    return dbRead('SELECT column_name, data_type FROM user_tab_columns WHERE table_name = ' + lit(table) + ' ORDER BY column_id', 2000).then(function (r) {
        var m = {};
        r.forEach(function (c) { m[c.COLUMN_NAME] = c.DATA_TYPE === 'NUMBER' ? 'NUMBER' : 'VARCHAR2'; });
        return m;
    });
}

// ── Load engine ────────────────────────────────────────────────
function dsProgress(id, text) {
    if (text) DS.busy[id] = text; else delete DS.busy[id];
    var el = document.querySelector('[data-ds-progress="' + id + '"]');
    if (el) el.innerHTML = text ? '<span class="fs-spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;vertical-align:middle;"></span> ' + esc(text) : '';
    var m = $('ds-save-progress'); if (m && id === 'new') m.textContent = text || '';
}
/** Inserts rows under loadId; on any failure removes that partial load and rethrows. */
function dsFill(id, table, map, rows, loadId) {
    var stmts;
    try { stmts = dsInsertStatements(table, map, rows, loadId); } catch (e) { return Promise.reject(e); }
    var done = 0;
    var next = function (k) {
        if (k >= stmts.length) return Promise.resolve();
        return dbWrite(stmts[k]).then(function () {
            done = Math.min(rows.length, (k + 1) * DS_BATCH_ROWS);
            dsProgress(id, 'Inserting rows… ' + done.toLocaleString() + ' / ' + rows.length.toLocaleString());
            return next(k + 1);
        });
    };
    return next(0).catch(function (e) {
        return dbWrite('DELETE FROM ' + dsQ(table) + ' WHERE ' + dsQ('FSQ_LOAD_ID') + ' = ' + loadId)
            .catch(function () { }).then(function () { throw e; });
    });
}
function dsFinish(ds, loadId, t0) {
    var chain = ds.mode === 'APPEND' ? Promise.resolve()
        : dbWrite('DELETE FROM ' + dsQ(ds.table) + ' WHERE ' + dsQ('FSQ_LOAD_ID') + ' <> ' + loadId + ' OR ' + dsQ('FSQ_LOAD_ID') + ' IS NULL');
    return chain.then(function () { return dbRead('SELECT COUNT(*) AS n FROM ' + dsQ(ds.table), 1); }).then(function (r) {
        var n = r.length ? +r[0].N : null;
        return dsRegUpdate(ds.id, 'current_load_id = ' + loadId + ', row_count = ' + (n == null ? 'NULL' : n) +
            ", last_status = 'OK', last_error = NULL, last_ms = " + (Date.now() - t0) +
            ', refreshed_by = ' + vlit(appUserName(), 120) + ', refreshed_date = SYSDATE, instance = ' + vlit(currentInstance(), 10));
    });
}
function dsFail(ds, e, t0) {
    var msg = String(e);
    return dsRegUpdate(ds.id, "last_status = 'ERROR', last_error = " + vlit(dsUtf8Cut(msg, 3900), 4000) + ', last_ms = ' + (Date.now() - t0))
        .catch(function () { }).then(function () { throw msg; });
}

/** Refresh: re-run the source SQL on Fusion and reload the APEX table (load-safe). */
function dsRefresh(ds, params, rebuild) {
    if (DS.busy[ds.id]) return Promise.reject('Already running');
    var t0 = Date.now(), values = params || ds.params || {};
    var names = detectParams(ds.sql), vals = {};
    names.forEach(function (n) { vals[n] = values[n] != null ? values[n] : (values[n.toUpperCase()] != null ? values[n.toUpperCase()] : ''); });
    dsProgress(ds.id, 'Running the query on Fusion…');
    return dsRegUpdate(ds.id, "last_status = 'RUNNING'" + (params ? ', param_json = ' + vlit(JSON.stringify(vals), 4000) : ''))
        .then(function () { return fsql(names.length ? substituteParams(ds.sql, vals) : ds.sql, ds.rowLimit); })
        .then(function (r) {
            dsProgress(ds.id, r.rowCount.toLocaleString() + ' rows from Fusion — preparing the table…');
            var tablePrep;
            if (rebuild) {
                tablePrep = dbWrite('DROP TABLE ' + dsQ(ds.table) + ' PURGE').catch(function () { }).then(function () {
                    var map = dsMapColumns(r.columns, r.rows, null);
                    return dbWrite(dsCreateTableSql(ds.table, map)).then(function () { ds.loadId = 0; return map; });
                });
            } else {
                tablePrep = dsTableColumns(ds.table).then(function (existing) {
                    if (!Object.keys(existing).length) {                         // table was dropped outside the app
                        var m0 = dsMapColumns(r.columns, r.rows, null);
                        return dbWrite(dsCreateTableSql(ds.table, m0)).then(function () { return m0; });
                    }
                    var map = dsMapColumns(r.columns, r.rows, existing);
                    // New columns in the query → add them to the table
                    return map.filter(function (c) { return c.isNew; }).reduce(function (p, c) {
                        return p.then(function () { return dbWrite('ALTER TABLE ' + dsQ(ds.table) + ' ADD (' + dsQ(c.col) + ' ' + dsTypeSql(c.type) + ')'); });
                    }, Promise.resolve()).then(function () { return map; });
                });
            }
            return tablePrep.then(function (map) {
                var loadId = (ds.loadId || 0) + 1;
                return dsFill(ds.id, ds.table, map, r.rows, loadId).then(function () {
                    dsProgress(ds.id, 'Finishing…');
                    return dsFinish(ds, loadId, t0).then(function () {
                        return dsRegUpdate(ds.id, 'column_count = ' + map.length).then(function () { return { rows: r.rowCount, capped: r.capped }; });
                    });
                });
            });
        })
        .catch(function (e) { return dsFail(ds, e, t0); })
        .then(function (res) { dsProgress(ds.id, null); return res; }, function (e) { dsProgress(ds.id, null); throw e; });
}

/** First save: registry row + table + load 1, from the rows already in the grid. */
function dsCreate(meta, R) {
    var t0 = Date.now(), map = dsMapColumns(R.columns, R.rows, null), ds;
    dsProgress('new', 'Checking names…');
    return dsEnsureRegistry()
        .then(function () {
            return dbRead('SELECT (SELECT COUNT(*) FROM ' + DS.REG + ' WHERE UPPER(dataset_name) = UPPER(' + lit(meta.name) + ')) AS n_name, ' +
                '(SELECT COUNT(*) FROM user_tables WHERE table_name = ' + lit(meta.table) + ') AS n_tab FROM dual', 1);
        })
        .then(function (r) {
            if (+r[0].N_NAME > 0) throw 'A dataset named "' + meta.name + '" already exists — refresh it from the APEX Data tab or choose another name.';
            if (+r[0].N_TAB > 0) throw 'Table ' + meta.table + ' already exists in APEX — choose another table name.';
            dsProgress('new', 'Creating table ' + meta.table + '…');
            return dbWrite(dsCreateTableSql(meta.table, map));
        })
        .then(function () {
            return dbWrite('INSERT INTO ' + DS.REG + ' (dataset_name, table_name, description, source_sql, param_json, row_limit, refresh_mode, current_load_id, column_count, instance, created_by, created_date, last_status) VALUES (' +
                vlit(meta.name, 200) + ', ' + lit(meta.table) + ', ' + vlit(meta.description, 1000) + ', ' + clobLit(meta.sql) + ', ' +
                vlit(JSON.stringify(meta.params || {}), 4000) + ', ' + meta.rowLimit + ', ' + lit(meta.mode) + ', 0, ' + map.length + ', ' +
                vlit(currentInstance(), 10) + ', ' + vlit(appUserName(), 120) + ", SYSDATE, 'RUNNING')");
        })
        .then(function () { return dbRead('SELECT dataset_id FROM ' + DS.REG + ' WHERE table_name = ' + lit(meta.table), 1); })
        .then(function (r) {
            ds = { id: r[0].DATASET_ID, table: meta.table, mode: meta.mode };
            return dsFill('new', meta.table, map, R.rows, 1);
        })
        .then(function () { dsProgress('new', 'Finishing…'); return dsFinish(ds, 1, t0); })
        .catch(function (e) { if (ds) return dsFail(ds, e, t0); throw e; })
        .then(function () { dsProgress('new', null); }, function (e) { dsProgress('new', null); throw e; });
}

// ── Save dialog (from the results grid) ────────────────────────
function openSaveToApex() {
    var R = FS.result;
    if (!R || !R.columns || !R.columns.length) { toast('Run a query first — its result is what gets saved', 'warn'); return; }
    if (!R.source || !R.source.sql) { toast('Run the query again, then save', 'warn'); return; }
    var baseName = FS.currentQuery ? FS.currentQuery.name : 'Fusion query ' + new Date().toISOString().slice(0, 10);
    var map = dsMapColumns(R.columns, R.rows, null);
    var params = R.source.params || {}, pnames = Object.keys(params);
    var body =
        '<div class="fs-form">' +
        '<label>Dataset name</label><input id="ds-name" maxlength="200" value="' + esc(baseName) + '">' +
        '<label>APEX table <small>created in the APEX schema · letters, digits, _</small></label><input id="ds-table" maxlength="60" value="' + esc(dsTableName(baseName)) + '">' +
        '<label>Description</label><input id="ds-desc" maxlength="1000">' +
        '<label>On refresh</label>' +
        '<div class="ds-modes"><label class="fs-radio"><input type="radio" name="ds-mode" value="REPLACE" checked><span><b>Replace</b><br><small>Keep only the latest data</small></span></label>' +
        '<label class="fs-radio"><input type="radio" name="ds-mode" value="APPEND"><span><b>Append</b><br><small>Keep every load as history (FSQ_LOAD_ID / FSQ_LOADED_AT)</small></span></label></div>' +
        '<label>Row limit for refreshes <small>rows fetched from Fusion each refresh (1–100,000)</small></label><input id="ds-limit" type="number" min="1" max="100000" value="' + Math.max(R.limit || 100, R.rows.length) + '">' +
        '</div>' +
        '<div class="ds-summary"><i class="fa-solid fa-table"></i> <b>' + R.rows.length.toLocaleString() + '</b> rows × <b>' + map.length + '</b> columns will be saved now.' +
        (R.capped ? '<div class="ds-warn"><i class="fa-solid fa-scissors"></i> This result was capped at ' + R.limit.toLocaleString() + ' rows by the Rows limit. Raise it and run again to save everything, or set a higher refresh row limit above and refresh after saving.</div>' : '') +
        (pnames.length ? '<div class="ds-params"><i class="fa-solid fa-sliders"></i> Parameters saved for refresh: ' + pnames.map(function (p) { return '<code>' + esc(p) + ' = ' + esc(params[p] === '' ? 'NULL' : params[p]) + '</code>'; }).join(' ') + '</div>' : '') +
        '</div>' +
        '<details class="fs-details"><summary>Columns (' + map.length + ')</summary><table class="ds-cols"><tr><th>Fusion column</th><th>APEX column</th><th>Type</th></tr>' +
        map.map(function (c) { return '<tr><td>' + esc(c.src) + '</td><td><code>' + esc(c.col) + '</code></td><td>' + (c.type === 'NUMBER' ? 'NUMBER' : 'VARCHAR2(4000)') + '</td></tr>'; }).join('') +
        '</table></details>' +
        '<details class="fs-details"><summary>Source SQL</summary><div class="fs-code-box"><pre>' + esc(R.source.sql) + '</pre></div></details>' +
        '<div class="fs-muted" id="ds-save-progress" style="margin-top:10px;min-height:1.2em;"></div>';
    openModal('Save result to APEX', body, [
        { label: 'Cancel', cls: 'ghost', onClick: closeModal },
        { label: '<i class="fa-solid fa-cloud-arrow-up"></i> Save to APEX', cls: 'primary', onClick: function () { dsSaveFromDialog(this); } }
    ], true);
    var tableTouched = false;
    $('ds-table').addEventListener('input', function () { tableTouched = true; });
    $('ds-table').addEventListener('blur', function () { this.value = dsTableName(this.value.replace(/^FSQ_/i, '')); });
    $('ds-name').addEventListener('input', function () { if (!tableTouched) $('ds-table').value = dsTableName(this.value); });
    setTimeout(function () { $('ds-name').select(); }, 30);
}
function dsSaveFromDialog(btn) {
    var R = FS.result;
    var meta = {
        name: $('ds-name').value.trim(),
        table: dsTableName($('ds-table').value.replace(/^FSQ_/i, '')),
        description: $('ds-desc').value.trim(),
        mode: (document.querySelector('input[name="ds-mode"]:checked') || {}).value || 'REPLACE',
        rowLimit: Math.max(1, Math.min(100000, parseInt($('ds-limit').value, 10) || 1000)),
        sql: R.source.sql, params: R.source.params || {}
    };
    if (!meta.name) { toast('Give the dataset a name', 'warn'); return; }
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';
    dsCreate(meta, R).then(function () {
        closeModal();
        toast('Saved ' + R.rows.length.toLocaleString() + ' rows to ' + meta.table);
        return dsLoadList();
    }).catch(function (e) {
        btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Save to APEX';
        var p = $('ds-save-progress'); if (p) p.innerHTML = '<span style="color:#b91c1c;"><i class="fa-solid fa-triangle-exclamation"></i> ' + esc(e) + '</span>';
        dsLoadList();
    });
}

// ── APEX Data tab ──────────────────────────────────────────────
function dsRenderStatus() {
    var el = $('fs-ds-status'); if (!el) return;
    var st = DS.state, html;
    if (st === 'loading') html = '<span class="fs-spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;vertical-align:middle;"></span> Loading datasets…';
    else if (st === 'ready') html = '<i class="fa-solid fa-database" style="color:var(--fs-green)"></i> ' + DS.list.length + ' dataset' + (DS.list.length === 1 ? '' : 's') + ' in the APEX database · registry <code>WMS_FUSION_SQL_DATASETS</code>';
    else if (st === 'missing') html = '<i class="fa-solid fa-circle-info" style="color:var(--fs-amber)"></i> No datasets yet. Run a query in the SQL Builder and click <b>Save to APEX</b> on the results — the tables are created automatically.';
    else html = '<i class="fa-solid fa-plug-circle-xmark" style="color:#b91c1c"></i> APEX database not reachable. <span class="fs-muted">' + esc((DS.error || '').slice(0, 160)) + '</span> <button class="fs-btn sm" onclick="dsLoadList()"><i class="fa-solid fa-rotate"></i> Retry</button>';
    el.innerHTML = '<div>' + html + '</div>';
}
function dsRenderList() {
    var el = $('fs-ds-list'); if (!el) return;
    var term = (($('fs-ds-search') || {}).value || '').toLowerCase();
    var list = DS.list.filter(function (d) { return !term || (d.name + ' ' + d.table + ' ' + d.description + ' ' + d.sql).toLowerCase().indexOf(term) >= 0; });
    if (!DS.list.length) { el.innerHTML = ''; return; }
    el.innerHTML = list.map(function (d) {
        var st = DS.busy[d.id] ? 'RUNNING' : (d.status || 'OK');
        var pn = detectParams(d.sql);
        return '<div class="fs-q ds-card">' +
            '<div class="fs-q-head"><div class="fs-q-name">' + esc(d.name) + '</div><div style="display:flex;gap:4px;">' +
            '<span class="fs-q-tag" style="background:#f1edea;color:#57504b;">' + esc(d.mode) + '</span>' +
            '<span class="ds-st ds-st-' + st.toLowerCase() + '">' + (st === 'OK' ? '<i class="fa-solid fa-check"></i> OK' : st === 'ERROR' ? '<i class="fa-solid fa-xmark"></i> Error' : '<i class="fa-solid fa-spinner fa-spin"></i> Running') + '</span></div></div>' +
            '<div class="ds-table"><i class="fa-solid fa-table"></i> <code>' + esc(d.table) + '</code>' + (d.description ? ' <span class="fs-muted">· ' + esc(d.description) + '</span>' : '') + '</div>' +
            '<div class="ds-stats">' +
            '<div><b>' + (d.rows != null ? (+d.rows).toLocaleString() : '—') + '</b><span>rows</span></div>' +
            '<div><b>' + (d.cols || '—') + '</b><span>columns</span></div>' +
            '<div><b>#' + (d.loadId || 0) + '</b><span>load</span></div>' +
            '<div><b>' + (d.ms != null ? fmtMs(+d.ms) : '—') + '</b><span>last refresh</span></div></div>' +
            '<div class="fs-q-who"><i class="fa-regular fa-clock"></i> ' + (d.refreshed ? 'Refreshed ' + esc(d.refreshed) + ' by ' + esc(d.refreshedBy || '?') : 'Created ' + esc(d.created || '') + ' by ' + esc(d.createdBy || '?')) +
            (d.instance ? ' · from ' + esc(d.instance) : '') + (pn.length ? ' · params: ' + pn.map(function (p) { return esc(p) + '=' + esc(d.params[p] == null || d.params[p] === '' ? 'NULL' : d.params[p]); }).join(', ') : '') + '</div>' +
            (st === 'ERROR' && d.error ? '<div class="ds-err">' + esc(d.error) + '</div>' : '') +
            '<pre>' + esc(d.sql) + '</pre>' +
            '<div class="ds-progress" data-ds-progress="' + d.id + '">' + (DS.busy[d.id] ? esc(DS.busy[d.id]) : '') + '</div>' +
            '<div class="fs-q-foot">' +
            '<button class="fs-btn sm primary" onclick="dsDoRefresh(' + d.id + ')" ' + (DS.busy[d.id] ? 'disabled' : '') + '><i class="fa-solid fa-rotate"></i> Refresh</button>' +
            (pn.length ? '<button class="fs-btn sm" onclick="dsDoRefresh(' + d.id + ', true)" title="Refresh with different parameter values"><i class="fa-solid fa-sliders"></i></button>' : '') +
            '<button class="fs-btn sm" onclick="dsView(' + d.id + ')"><i class="fa-solid fa-eye"></i> View data</button>' +
            '<button class="fs-btn sm" onclick="dsOpenSql(' + d.id + ')" title="Open the source SQL in the SQL Builder"><i class="fa-solid fa-code"></i> SQL</button>' +
            '<span style="flex:1"></span>' +
            '<button class="fs-icon-btn" title="Rebuild: drop and recreate the table from a fresh run (use when column types changed)" onclick="dsDoRebuild(' + d.id + ')"><i class="fa-solid fa-hammer"></i></button>' +
            '<button class="fs-icon-btn" title="Delete dataset and drop its table" onclick="dsDelete(' + d.id + ')"><i class="fa-regular fa-trash-can"></i></button>' +
            '</div></div>';
    }).join('') || '<div class="fs-muted">No datasets match.</div>';
}

function dsDoRefresh(id, ask) {
    var d = dsFind(id); if (!d) return;
    var go = function (params) {
        dsRenderList();
        dsRefresh(d, params).then(function (res) {
            toast(d.name + ': ' + res.rows.toLocaleString() + ' rows loaded into ' + d.table + (res.capped ? ' (capped at the row limit)' : ''), res.capped ? 'warn' : 'ok');
            return dsLoadList();
        }).catch(function (e) { toast(d.name + ': refresh failed — ' + String(e).split('\n')[0], 'err'); dsLoadList(); });
    };
    if (ask) {
        var names = detectParams(d.sql);
        var saved = lsGet('fusionSql.params', {});
        names.forEach(function (n) { if (d.params[n] != null) saved[n.toUpperCase()] = d.params[n]; });
        lsSet('fusionSql.params', saved);
        askParams(names, d.sql).then(function (vals) { if (vals) go(vals); });
    } else go(null);
}
function dsDoRebuild(id) {
    var d = dsFind(id); if (!d) return;
    confirmModal('Rebuild ' + d.table + '?', 'The table is dropped and recreated from a fresh run of the source SQL (column types are re-detected). Previous loads are lost.', function () {
        dsRenderList();
        dsRefresh(d, null, true).then(function (res) { toast(d.table + ' rebuilt with ' + res.rows.toLocaleString() + ' rows'); return dsLoadList(); })
            .catch(function (e) { toast('Rebuild failed — ' + String(e).split('\n')[0], 'err'); dsLoadList(); });
    });
}
function dsDelete(id) {
    var d = dsFind(id); if (!d) return;
    confirmModal('Delete "' + d.name + '"?', 'Drops the APEX table ' + d.table + ' and removes the dataset for everyone.', function () {
        dbWrite('DROP TABLE ' + dsQ(d.table) + ' PURGE').catch(function (e) { if (!/ORA-00942/.test(String(e))) throw e; })
            .then(function () { return dbWrite('DELETE FROM ' + DS.REG + ' WHERE dataset_id = ' + parseInt(d.id, 10)); })
            .then(function () { toast('Deleted ' + d.table); return dsLoadList(); })
            .catch(function (e) { toast('Delete failed: ' + e, 'err'); });
    });
}
function dsOpenSql(id) {
    var d = dsFind(id); if (!d) return;
    var saved = lsGet('fusionSql.params', {});
    Object.keys(d.params || {}).forEach(function (k) { saved[k.toUpperCase()] = d.params[k]; });
    lsSet('fusionSql.params', saved);
    setCurrentQuery(null); setSql(d.sql); showTab('builder');
    toast('Source SQL of "' + d.name + '" loaded — its parameter values are pre-filled');
}
function dsView(id) {
    var d = dsFind(id); if (!d) return;
    $('fs-ds-sql').value = 'SELECT *\nFROM ' + d.table + '\nORDER BY FSQ_LOAD_ID DESC';
    dsRunQuery();
    $('fs-ds-sql').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Query the saved tables back (ai/executequery) ──────────────
function dsRunQuery() {
    var sql = $('fs-ds-sql').value.trim().replace(/;\s*$/, '');
    if (!sql) return;
    $('fs-ds-meta').textContent = 'Running on APEX…';
    var t0 = Date.now();
    apexPost('/executequery', { sql: sql, maxRows: Math.max(1, Math.min(50000, parseInt($('fs-ds-max').value, 10) || 1000)) }).then(function (d) {
        var cols = (d.columns || []).map(function (c) { return String(c.name || c); });
        var rows = (d.rows || []).map(function (r) {
            if (!Array.isArray(r)) return r;
            var o = {}; cols.forEach(function (c, i) { o[c] = r[i]; }); return o;
        });
        DS.query = { columns: cols, rows: rows, sql: sql };
        $('fs-ds-meta').textContent = rows.length.toLocaleString() + ' rows · ' + fmtMs(Date.now() - t0);
        renderSimpleGrid($('fs-ds-grid'), cols, rows);
    }).catch(function (e) {
        DS.query = null;
        $('fs-ds-meta').textContent = '';
        $('fs-ds-grid').innerHTML = '<div class="fs-error-box" style="margin:10px;">' + esc(e) + '</div>';
    });
}
function dsExport(kind) {
    var Q = DS.query;
    if (!Q || !Q.rows.length) { toast('Run an APEX query first', 'warn'); return; }
    var name = 'APEX_' + nowStamp();
    if (kind === 'csv' || typeof ExcelJS === 'undefined') {
        var q = function (v) { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
        var lines = [Q.columns.map(q).join(',')].concat(Q.rows.map(function (r) { return Q.columns.map(function (c) { return q(r[c]); }).join(','); }));
        downloadBlob(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), name + '.csv');
        return;
    }
    var wb = new ExcelJS.Workbook();
    var ws = wb.addWorksheet('Data', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = Q.columns.map(function (c) { return { header: c, key: c, width: Math.max(12, Math.min(45, c.length + 4)) }; });
    Q.rows.forEach(function (r) { ws.addRow(r); });
    ws.getRow(1).eachCell(function (cell) {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC74634' } };
    });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: Q.columns.length } };
    wb.xlsx.writeBuffer().then(function (buf) {
        downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name + '.xlsx');
    });
}
