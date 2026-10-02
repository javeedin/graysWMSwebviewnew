/* AI Agent — Fusion SQL features as tools (page side, APEX through the ai/ gateway, Fusion Model through fm* actions):
   company knowledge (approved facts + verified examples, the same selection as Fusion SQL's Ask AI), saved queries,
   knowledge proposals, watchdogs, process flows, the setup checklist, APEX datasets and the Fusion Model.
   APEX reads never contain DBMS_ / UTL_ / UPDATE / DELETE words (the gateway refuses them even inside quotes). */

/** Words safe for an APEX read (no gateway-blocked words), upper case, max 6. */
AG.words = function (s) {
    return String(s || '').toUpperCase().split(/[^A-Z0-9_$#]+/).filter(function (w) { return w.length > 1 && !/^(UPDATE|DELETE|DBMS_.*|UTL_.*|INSERT|MERGE|DROP|TRUNCATE|ALTER|GRANT|EXECUTE)$/.test(w); }).slice(0, 6);
};
AG.likeAll = function (expr, words) { return words.length ? words.map(function (w) { return expr + " LIKE '%" + w.replace(/'/g, "''") + "%'"; }).join(' AND ') : '1 = 1'; };
AG.tableMissing = function (e, page) { return /ORA-00942|table or view does not exist/i.test(String(e)) ? 'The table does not exist yet — open ' + page + ' once (it creates its tables).' : String(e); };

/** A table the page holds (APEX / Fusion Model / REST): kept in the results panel, chartable, summarised for the model. */
AG.pageResult = function (title, columns, rowsArr, extra) {
    var id = 'pg_' + hex16().slice(0, 10);
    var cols = columns.map(function (c, i) {
        var name = typeof c === 'string' ? c : c.name, seen = 0, num = 0;
        rowsArr.slice(0, 300).forEach(function (r) { var v = r[i]; if (v === null || v === undefined || v === '') return; seen++; if (!isNaN(parseFloat(v)) && isFinite(v)) num++; });
        return { name: name, type: seen && num === seen ? 'number' : 'text' };
    });
    var data = Object.assign({ ok: true, result_id: id, title: title, columns: cols, rows: rowsArr, row_count: rowsArr.length, pod: AG.pod }, extra || {});
    AG.addResult({ result_id: id, title: title, row_count: rowsArr.length, page_data: data }, true);
    var first = rowsArr.slice(0, 25).map(function (row) { var o = {}; cols.forEach(function (c, i) { var v = row[i]; o[c.name] = typeof v === 'string' && v.length > 160 ? v.slice(0, 157) + '…' : v; }); return o; });
    return { result_id: id, title: title, row_count: rowsArr.length, columns: cols, first_rows: first };
};
/** rows() objects → page result + model text */
AG.tableOut = function (title, list, emptyText) {
    if (!list.length) return { ok: true, content: emptyText || 'Nothing found.' };
    var cols = Object.keys(list[0]);
    var s = AG.pageResult(title, cols, list.map(function (o) { return cols.map(function (c) { return o[c]; }); }));
    return { ok: true, content: JSON.stringify(s), data: s };
};

// ── knowledge ──
AG.tool('knowledge_lookup', function (inp) {
    return rows("SELECT fact_id, kind, object_name, column_name, fact, words, example_sql, confidence FROM wms_fusion_knowledge WHERE status = 'APPROVED' ORDER BY confidence DESC, fact_id FETCH FIRST 1500 ROWS ONLY", 1500).then(function (list) {
        if (!list.length) return { ok: true, content: 'No approved company knowledge yet.' };
        var facts = list.map(function (f) { return { id: f.FACT_ID, kind: f.KIND, object: f.OBJECT_NAME, column: f.COLUMN_NAME, fact: f.FACT, words: f.WORDS, sql: f.EXAMPLE_SQL, confidence: +f.CONFIDENCE || 0.5 }; });
        var E = window.KB_ENGINE;
        if (!E) return { ok: false, content: 'The knowledge engine is not loaded.' };
        var sel = E.selectFacts(facts, inp.question || '', [], { limit: 40, budget: 7000 });
        if (!sel.length) return { ok: true, content: 'No approved facts or verified examples match this question.' };
        var ids = sel.map(function (f) { return +f.id; }).filter(function (n) { return n > 0; });
        if (ids.length) dbWrite('UPDATE wms_fusion_knowledge SET use_count = NVL(use_count, 0) + 1, last_used = SYSDATE WHERE fact_id IN (' + ids.join(',') + ')').catch(function () { });
        var text = E.promptText(sel).replace(/SQL:\s*([\s\S]*?)(?=\n\n|\nQ:|$)/g, function (m, sql) { return 'SQL:\n```sql\n' + sql.trim() + '\n```'; });
        return { ok: true, content: text, data: { facts: sel.length } };
    }, function (e) { return { ok: false, content: AG.tableMissing(e, 'Fusion SQL › Knowledge') }; });
});
AG.tool('knowledge_propose', function (inp) {
    var kind = String(inp.kind || 'RULE').toUpperCase(), subj = String(inp.subject || '').toUpperCase().trim(), fact = String(inp.fact || '').trim();
    if (!fact || !/^(TABLE|COLUMN|VALUE|JOIN|RULE|TERM)$/.test(kind)) return { ok: false, content: 'kind (TABLE/COLUMN/VALUE/JOIN/RULE/TERM) and fact are required.' };
    var p = subj.split('.'), obj = p[0] || null, col = p[1] || null;
    var key = (kind + '|' + subj + '|' + fact.toUpperCase().slice(0, 200)).slice(0, 400);
    var words = AG.words(fact).join(' ').slice(0, 400);
    return dbWrite("MERGE INTO wms_fusion_knowledge k USING (SELECT " + lit(key) + " AS fk FROM dual) s ON (k.fact_key = s.fk) " +
        "WHEN MATCHED THEN UPDATE SET seen_count = NVL(seen_count, 1) + 1, confidence = LEAST(0.95, NVL(confidence, 0.5) + 0.05) WHERE status <> 'REJECTED' " +
        "WHEN NOT MATCHED THEN INSERT (fact_key, kind, object_name, column_name, fact, words, source, status, confidence, seen_count, evidence, instance, created_by, created_date) VALUES (" +
        [lit(key), lit(kind), vlit(obj, 128), vlit(col, 128), vlit(fact, 2000), vlit(words, 400), "'AI'", "'PROPOSED'", '0.6', '1', "'AI Agent'", lit(AG.pod), vlit(appUser(), 100), 'SYSDATE'].join(', ') + ')')
        .then(function () { return { ok: true, content: 'Proposed for the Knowledge tab (a person approves it).' }; }, function (e) { return { ok: false, content: AG.tableMissing(e, 'Fusion SQL › Knowledge') }; });
});

// ── saved queries ──
AG.tool('saved_queries_search', function (inp) {
    var w = AG.words(inp.words);
    return rows("SELECT query_id AS id, query_name AS name, tag, SUBSTR(description, 1, 300) AS description, run_count, TO_CHAR(NVL(updated_date, created_date), 'YYYY-MM-DD') AS changed FROM wms_fusion_sql_queries WHERE " +
        (w.length ? '(' + AG.likeAll("UPPER(query_name || ' ' || tag || ' ' || description)", w) + ') OR (' + AG.likeAll('UPPER(TO_CHAR(SUBSTR(sql_text, 1, 3000)))', w) + ')' : '1 = 1') +
        ' ORDER BY run_count DESC NULLS LAST FETCH FIRST 25 ROWS ONLY', 25).then(function (list) {
            return list.length ? { ok: true, content: JSON.stringify(list) } : { ok: true, content: 'No saved query matches.' };
        }, function (e) { return { ok: false, content: AG.tableMissing(e, 'Fusion SQL') }; });
});
AG.tool('saved_query_get', function (inp) {
    var id = parseInt(inp.id, 10); if (!id) return { ok: false, content: 'id required' };
    var parts = []; for (var i = 0; i < 12; i++) parts.push('TO_CHAR(SUBSTR(sql_text, ' + (i * 1300 + 1) + ', 1300)) AS p' + i);
    return rows('SELECT query_name, tag, description, ' + parts.join(', ') + ' FROM wms_fusion_sql_queries WHERE query_id = ' + id, 1).then(function (r) {
        if (!r.length) return { ok: false, content: 'No saved query ' + id };
        var q = r[0], sql = ''; for (var i = 0; i < 12; i++) sql += q['P' + i] || '';
        var params = (sql.match(/\{\{\s*([A-Za-z0-9_]+)[^}]*\}\}|:([A-Za-z][A-Za-z0-9_]*)/g) || []).filter(function (x, i, a) { return a.indexOf(x) === i; });
        return { ok: true, content: 'Name: ' + q.QUERY_NAME + (q.TAG ? ' [' + q.TAG + ']' : '') + '\n' + (q.DESCRIPTION || '') + (params.length ? '\nParameters to fill in (replace before running): ' + params.join(', ') : '') + '\n```sql\n' + sql + '\n```' };
    }, function (e) { return { ok: false, content: String(e) }; });
});
AG.saveQuery = function (inp) {
    var name = String(inp.name || '').trim().slice(0, 200), sql = String(inp.sql || '').trim().replace(/;\s*$/, '');
    if (!name || !/^\s*(SELECT|WITH)\b/i.test(sql)) return Promise.resolve({ ok: false, content: 'A name and a SELECT / WITH query are needed.' });
    if (sql.length > 15600) return Promise.resolve({ ok: false, content: 'The query is longer than saved queries allow (15,600 characters).' });
    var by = vlit(appUser(), 100);
    return dbWrite('MERGE INTO wms_fusion_sql_queries q USING (SELECT ' + lit(name) + ' AS n FROM dual) s ON (UPPER(q.query_name) = UPPER(s.n)) ' +
        'WHEN MATCHED THEN UPDATE SET tag = ' + vlit(inp.category, 60) + ', description = ' + vlit(inp.description, 1000) + ', sql_text = ' + clob(sql) + ', sql_length = ' + sql.length + ', instance = ' + lit(AG.pod) + ', updated_by = ' + by + ', updated_date = SYSDATE ' +
        'WHEN NOT MATCHED THEN INSERT (query_name, tag, description, sql_text, sql_length, instance, created_by, created_date) VALUES (' +
        [lit(name), vlit(inp.category, 60), vlit(inp.description, 1000), clob(sql), sql.length, lit(AG.pod), by, 'SYSDATE'].join(', ') + ')')
        .then(function () { return { ok: true, content: 'Saved as "' + name + '" (Fusion SQL › Saved queries).' }; }, function (e) { return { ok: false, content: AG.tableMissing(e, 'Fusion SQL') }; });
};
AG.tool('save_query', function (inp) { return AG.saveQuery(inp); });

// ── watchdogs ──
AG.tool('watchdogs_status', function (inp) {
    var w = AG.words(inp.words);
    return rows("SELECT watch_id AS id, watch_name AS name, instance, metric, rule_type AS rule_, every_min, active, status, last_value, SUBSTR(last_message, 1, 300) AS message, TO_CHAR(last_run, 'YYYY-MM-DD HH24:MI') AS last_run, alert_count " +
        'FROM wms_fusion_watchdogs WHERE ' + AG.likeAll("UPPER(watch_name || ' ' || description)", w) + ' ORDER BY CASE status WHEN \'ALERT\' THEN 0 ELSE 1 END, watch_name FETCH FIRST 60 ROWS ONLY', 60)
        .then(function (list) { return AG.tableOut('Watchdogs', list, 'No watchdogs yet (Fusion SQL › Watchdogs).'); }, function (e) { return { ok: false, content: AG.tableMissing(e, 'Fusion SQL › Watchdogs') }; });
});
AG.createWatchdog = function (inp) {
    var sql = String(inp.sql || '').trim().replace(/;\s*$/, ''), rule = String(inp.rule || 'AUTO').toUpperCase();
    if (!/^\s*(SELECT|WITH)\b/i.test(sql)) return Promise.resolve({ ok: false, content: 'The watchdog needs a SELECT / WITH query.' });
    if (/\{\{|:[A-Za-z]/.test(sql.replace(/'[^']*'/g, ''))) return Promise.resolve({ ok: false, content: 'Fill in the parameters first (use SYSDATE for moving dates).' });
    if (rule !== 'AUTO' && (inp.limit === undefined || inp.limit === null)) return Promise.resolve({ ok: false, content: 'Rule ' + rule + ' needs a limit.' });
    var every = [15, 30, 60, 120, 240, 720, 1440].indexOf(+inp.schedule_min) >= 0 ? +inp.schedule_min : 60;
    var dir = { up: 'UP', down: 'DOWN' }[String(inp.direction || '').toLowerCase()] || 'BOTH';
    var now = new Date(), pad = function (n) { return ('0' + n).slice(-2); };
    var local = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
    return dbWrite('INSERT INTO wms_fusion_watchdogs (watch_name, description, sql_text, instance, metric, value_column, unit_label, rule_type, threshold, direction, sensitivity, every_min, notify, teams_webhook, email_to, cooldown_hours, status, next_run, created_by, created_date) VALUES (' +
        [vlit(inp.name, 200), "'Created by the AI Agent'", clob(sql), lit(inp.pod || AG.pod), inp.value_column ? "'VALUE'" : "'ROWS'", vlit(inp.value_column, 128), 'NULL', lit(rule),
            inp.limit != null && !isNaN(+inp.limit) ? +inp.limit : 'NULL', lit(dir), "'MEDIUM'", every, "'Y'", 'NULL', 'NULL', 6, "'NEW'", "TO_DATE(" + lit(local) + ", 'YYYY-MM-DD HH24:MI:SS')", vlit(appUser(), 100), 'SYSDATE'].join(', ') + ')')
        .then(function () { return { ok: true, content: 'Watchdog "' + inp.name + '" created (every ' + every + ' min, ' + rule + '). It runs in any open Fusion SQL page on ' + (inp.pod || AG.pod) + '.' }; },
            function (e) { return { ok: false, content: AG.tableMissing(e, 'Fusion SQL › Watchdogs') }; });
};
AG.tool('watchdog_create', function (inp) { return AG.createWatchdog(inp); });

// ── flows, setups, datasets ──
AG.tool('flows_list', function (inp) {
    var w = AG.words(inp.words);
    return rows("SELECT f.flow_id AS id, f.flow_name AS name, SUBSTR(f.description, 1, 300) AS description, (SELECT LISTAGG(s.step_name, ' → ') WITHIN GROUP (ORDER BY s.step_no) FROM wms_fusion_flow_steps s WHERE s.flow_id = f.flow_id) AS steps " +
        'FROM wms_fusion_flows f WHERE ' + AG.likeAll("UPPER(f.flow_name || ' ' || f.description)", w) + ' ORDER BY f.flow_name FETCH FIRST 40 ROWS ONLY', 40)
        .then(function (list) { return list.length ? { ok: true, content: JSON.stringify(list) + '\nRun a flow for one document in Fusion SQL › Flows (open_page fusionsql).' } : { ok: true, content: 'No flows found.' }; },
            function (e) { return { ok: false, content: AG.tableMissing(e, 'Fusion SQL › Flows') }; });
});
AG.tool('setups_status', function (inp) {
    var m = String(inp.module || '').toUpperCase().replace(/[^A-Z0-9_]/g, '');
    return rows("SELECT t.module_code AS module, t.task_name AS task, t.mandatory, NVL(r.status, 'NOT CHECKED') AS status, r.row_count, TO_CHAR(r.checked_date, 'YYYY-MM-DD') AS checked " +
        'FROM wms_fusion_setup_tasks t LEFT JOIN wms_fusion_setup_results r ON r.task_id = t.task_id AND r.instance = ' + lit(AG.pod) +
        " WHERE t.active = 'Y'" + (m ? ' AND t.module_code = ' + lit(m) : '') + ' ORDER BY t.module_code, t.seq FETCH FIRST 400 ROWS ONLY', 400)
        .then(function (list) {
            if (!list.length) return { ok: true, content: 'No setup tasks (Fusion SQL › Fusion Setups).' };
            var by = {};
            list.forEach(function (r) { var b = by[r.MODULE] = by[r.MODULE] || { done: 0, missing: 0, unchecked: 0 }; if (r.STATUS === 'DONE') b.done++; else if (r.STATUS === 'NOT CHECKED') b.unchecked++; else b.missing++; });
            var out = AG.tableOut('Setup checklist · ' + AG.pod, list);
            out.content = 'Per module: ' + JSON.stringify(by) + '\n' + out.content;
            return out;
        }, function (e) { return { ok: false, content: AG.tableMissing(e, 'Fusion SQL › Fusion Setups') }; });
});
AG.tool('datasets_list', function (inp) {
    var w = AG.words(inp.words);
    return rows("SELECT dataset_name AS name, table_name, SUBSTR(description, 1, 200) AS description, row_count, TO_CHAR(refreshed_date, 'YYYY-MM-DD HH24:MI') AS refreshed, last_status FROM wms_fusion_sql_datasets WHERE " +
        AG.likeAll("UPPER(dataset_name || ' ' || description)", w) + ' ORDER BY dataset_name FETCH FIRST 50 ROWS ONLY', 50)
        .then(function (list) { return list.length ? { ok: true, content: JSON.stringify(list) + '\nThe tables can be read with APEX SQL in Fusion SQL › APEX Data.' } : { ok: true, content: 'No datasets saved to APEX yet.' }; },
            function (e) { return { ok: false, content: AG.tableMissing(e, 'Fusion SQL') }; });
});

// ── Fusion Model ──
AG.tool('model_search', function (inp) {
    return host('fmSearch', { query: inp.question || '', k: 15 }, 60000).then(function (d) {
        if (!d || d.ok === false) return { ok: false, content: (d && d.error) || 'Fusion Model search failed' };
        var hits = (d.hits || []).map(function (h) { return '- [' + h.kind + '] ' + h.title + (h.ref ? ' (' + h.ref + ')' : '') + (h.detail ? ': ' + String(h.detail).slice(0, 200) : '') + (h.rule ? ' RULE: ' + h.rule : ''); });
        return { ok: true, content: hits.length ? hits.join('\n') + '\nUse model_evaluate with EVALUATE SUMMARIZECOLUMNS(…) for measures.' : 'Nothing in the Fusion Model matches.' };
    }, function (e) { return { ok: false, content: 'Fusion Model: ' + e }; });
});
AG.tool('model_evaluate', function (inp) {
    return host('fmEvaluateText', { text: inp.query || '' }, 180000).then(function (d) {
        if (!d || d.ok === false) return { ok: false, content: (d && d.error) || 'Evaluate failed' };
        var r = d.result || {}, cols = (r.columns || []).map(function (c) { return c.name; });
        var s = AG.pageResult('Fusion Model · ' + (cols.slice(-1)[0] || 'measures'), cols, r.rows || []);
        return { ok: true, content: JSON.stringify(s), data: s };
    }, function (e) { return { ok: false, content: 'Fusion Model: ' + e }; });
});

// result_analyze on a page-held table (Fusion results are analysed in the host)
AG.analyzeLocal = function (inp) {
    var r = AG.resById(inp.result_id); if (!r || !r.data) return { ok: false, content: 'No result ' + inp.result_id };
    var d = r.data, names = d.columns.map(function (c) { return c.name.toUpperCase(); });
    var gi = (inp.group_by || []).map(function (g) { return names.indexOf(String(g).toUpperCase()); });
    if (gi.some(function (i) { return i < 0; })) return { ok: false, content: 'Unknown group_by column. Columns: ' + names.join(', ') };
    var ms = (inp.measures && inp.measures.length ? inp.measures : [{ column: names[0], agg: 'count' }]).map(function (m) { return { i: names.indexOf(String(m.column || '').toUpperCase()), agg: m.agg || 'sum', name: (m.agg + '_' + m.column).toUpperCase() }; });
    var groups = {}, order = [];
    d.rows.forEach(function (row) {
        if (inp.filter && Object.keys(inp.filter).some(function (k) { return String(row[names.indexOf(k.toUpperCase())]).toLowerCase() !== String(inp.filter[k]).toLowerCase(); })) return;
        var k = gi.map(function (i) { return row[i]; }).join('\u0001');
        if (!groups[k]) { groups[k] = { key: gi.map(function (i) { return row[i]; }), rows: [] }; order.push(k); }
        groups[k].rows.push(row);
    });
    var out = order.map(function (k) {
        var g = groups[k];
        return g.key.concat(ms.map(function (m) {
            var vals = g.rows.map(function (r) { return r[m.i]; }), nums = vals.map(parseFloat).filter(function (x) { return !isNaN(x); });
            switch (m.agg) { case 'count': return g.rows.length; case 'count_distinct': return vals.filter(function (v, i, a) { return a.indexOf(v) === i; }).length;
                case 'avg': return nums.length ? nums.reduce(function (a, b) { return a + b; }, 0) / nums.length : null; case 'min': return nums.length ? Math.min.apply(null, nums) : null;
                case 'max': return nums.length ? Math.max.apply(null, nums) : null; default: return nums.reduce(function (a, b) { return a + b; }, 0); }
        }));
    });
    var fi = gi.length;
    out.sort(function (a, b) { return (b[fi] || 0) - (a[fi] || 0); });
    if (inp.top > 0) out = out.slice(0, inp.top);
    var s = AG.pageResult(d.title + ' · by ' + (inp.group_by || []).join(', '), (inp.group_by || []).map(function (g) { return String(g).toUpperCase(); }).concat(ms.map(function (m) { return m.name; })), out);
    return { ok: true, content: JSON.stringify(s), data: s };
};
