/* Fusion SQL › "Send to Fusion Model": the current query becomes a table of the Fusion Model (the shared DuckDB
   dataset, fusionmodel/) — in an existing or new module, loaded from this pod, full / incremental / window, with the
   column types seen in the result. Optionally loaded at once; afterwards it refreshes with its module's schedule and
   can be used in measures, Reports, Dashboards and Ask AI. Host actions: fmModelGet, fmStatus, fmAddTable
   (+ fmProgress). Parameter values are fixed into the SQL (the model has no prompts). */

var TM = { model: null, onProgress: null };

function tmIdent(s, fallback) {
    var x = String(s || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').replace(/_+/g, '_');
    if (x && !/^[a-z]/.test(x)) x = 't_' + x;
    return (x || fallback || 'query').slice(0, 60);
}

/** Column → DuckDB type from the rows seen: whole numbers, decimals, dates (with or without time), text. */
function tmDetectTypes(cols, rows) {
    var out = {};
    cols.forEach(function (c) {
        var n = 0, num = true, int = true, date = true, time = false;
        for (var i = 0; i < rows.length && n < 500; i++) {
            var v = rows[i][c]; if (v === null || v === undefined || v === '') continue;
            n++; v = String(v).trim();
            if (num && !/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(v)) num = false;
            if (int && !/^-?\d{1,18}$/.test(v)) int = false;
            var m = /^(\d{4})[-\/](\d{2})[-\/](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(v);
            if (!m) date = false; else if (m[4] && (m[4] !== '00' || m[5] !== '00' || (m[6] && m[6] !== '00'))) time = true;
        }
        out[c] = !n ? 'VARCHAR' : int && /(^|_)(ID|NUM|NUMBER|KEY)$/i.test(c) ? 'BIGINT' : num ? (int ? 'BIGINT' : 'DOUBLE') : date ? (time ? 'TIMESTAMP' : 'DATE') : 'VARCHAR';
    });
    return out;
}

function openSendToModel() {
    var R = FS.result;
    if (!R || !R.columns || !R.columns.length) { toast('Run a query first — its SQL and columns go to the Fusion Model', 'warn'); return; }
    if (!R.source || !R.source.sql) { toast('Run the query again, then send it', 'warn'); return; }
    Promise.all([fsCall('fmModelGet', { appUser: appUserName() }), fsCall('fmStatus', { appUser: appUserName() })]).then(function (res) {
        if (res[0] && res[0].ok === false) throw res[0].error;
        TM.model = (res[0] && res[0].model) || { modules: [], tables: [] };
        var st = res[1] || {};
        if (st.status && !st.status.sharedReachable) throw 'The Fusion Model\'s shared folder is not reachable — set it in Fusion Model › Settings first.';
        tmDialog(R, !!st.isAdmin);
    }).catch(function (e) { toast(String(e), 'error'); });
}

function tmDialog(R, isAdmin) {
    var types = tmDetectTypes(R.columns, R.rows);
    var mods = TM.model.modules || [];
    var baseName = FS.currentQuery ? FS.currentQuery.name : 'fusion_query';
    var dateCols = R.columns.filter(function (c) { return types[c] === 'DATE' || types[c] === 'TIMESTAMP'; });
    var keyGuess = R.columns.find(function (c) { return /(^|_)ID$/i.test(c) && types[c] === 'BIGINT'; }) || '';
    var incGuess = R.columns.find(function (c) { return /LAST_UPDATE_DATE/i.test(c); }) || dateCols[0] || '';
    var params = (R.source && R.source.params) || {}, pnames = Object.keys(params);
    var opt = function (list, sel, none) { return (none ? '<option value="">' + none + '</option>' : '') + list.map(function (c) { return '<option' + (c === sel ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join(''); };
    var body =
        (!isAdmin ? '<div class="ds-warn" style="margin-bottom:10px"><i class="fa-solid fa-lock"></i> Only an AI admin can add tables to the Fusion Model — ask one to send this query.</div>' : '') +
        '<div class="fs-form">' +
        '<label>Module <small>one DuckDB file of the Fusion Model</small></label>' +
        '<select id="tm-mod">' + mods.map(function (m) { return '<option value="' + esc(m.name) + '">' + esc(m.title || m.name) + ' (' + esc(m.name) + ')</option>'; }).join('') +
        '<option value="__new"' + (mods.length ? '' : ' selected') + '>+ New module…</option></select>' +
        '<div id="tm-newmod"' + (mods.length ? ' style="display:none"' : '') + '><label>New module name <small>lowercase letters, digits, _</small></label><input id="tm-modname" value="fusion_sql" maxlength="60"></div>' +
        '<label>Table name <small>lowercase letters, digits, _ — used as module.table</small></label><input id="tm-name" maxlength="60" value="' + esc(tmIdent(baseName)) + '">' +
        '<label>Description <small>people and the AI read it</small></label><input id="tm-desc" maxlength="500" value="' + esc(FS.currentQuery && FS.currentQuery.description || '') + '">' +
        '<label>Load from</label><select id="tm-src"><option value="fusion:' + currentInstance() + '">Oracle Fusion — ' + currentInstance() + ' pod (always this pod)</option><option value="fusion">Oracle Fusion — whichever pod the refresher PC is logged in to</option></select>' +
        '<label>On each refresh</label>' +
        '<div class="ds-modes">' +
        '<label class="fs-radio"><input type="radio" name="tm-strat" value="full" checked><span><b>Full</b><br><small>Read everything again</small></span></label>' +
        '<label class="fs-radio"><input type="radio" name="tm-strat" value="incremental"' + (incGuess && keyGuess ? '' : '') + '><span><b>Incremental</b><br><small>Only rows changed since the last load (key + changed-date)</small></span></label>' +
        '<label class="fs-radio"><input type="radio" name="tm-strat" value="window"' + (dateCols.length ? '' : ' disabled') + '><span><b>Last N months</b><br><small>Reload a recent window by a date column</small></span></label></div>' +
        '<div class="tm-row"><div><label>Key column <small>unique per row — makes big loads fast</small></label><select id="tm-key">' + opt(R.columns, keyGuess, '(none)') + '</select></div>' +
        '<div id="tm-inc" style="display:none"><label>Changed-date column</label><select id="tm-inccol">' + opt(dateCols.length ? dateCols : R.columns, incGuess) + '</select></div>' +
        '<div id="tm-win" style="display:none"><label>Date column</label><select id="tm-wincol">' + opt(dateCols, dateCols[0]) + '</select><label>Months</label><input id="tm-months" type="number" min="1" max="120" value="3"></div></div>' +
        '<label class="fs-check"><input type="checkbox" id="tm-now" checked> Load it now (otherwise with the module\'s next refresh)</label>' +
        '</div>' +
        '<div class="ds-summary"><i class="fa-solid fa-cubes-stacked"></i> The query becomes <b>module.table</b> in the Fusion Model: usable in measures, Reports, Dashboards and Ask AI, refreshed with its module. ' +
        (R.capped ? 'The result grid was capped at ' + R.limit.toLocaleString() + ' rows — the model reads <b>all</b> rows (in pages).' : '') +
        (pnames.length ? '<div class="ds-params"><i class="fa-solid fa-sliders"></i> Parameters are fixed to the values you ran with: ' + pnames.map(function (p) { return '<code>' + esc(p) + ' = ' + esc(params[p] === '' ? 'NULL' : params[p]) + '</code>'; }).join(' ') + '</div>' : '') + '</div>' +
        '<details class="fs-details"><summary>Column types (' + R.columns.length + ') — detected from the result</summary><table class="ds-cols"><tr><th>Column</th><th>Type in the model</th></tr>' +
        R.columns.map(function (c) {
            return '<tr><td>' + esc(c) + '</td><td><select data-tmc="' + esc(c) + '">' + ['VARCHAR', 'BIGINT', 'DOUBLE', 'DATE', 'TIMESTAMP'].map(function (t) { return '<option' + (types[c] === t ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select></td></tr>';
        }).join('') + '</table></details>' +
        '<details class="fs-details"><summary>SQL the model will run</summary><div class="fs-code-box"><pre>' + esc(tmSql(R)) + '</pre></div></details>' +
        '<div class="fs-muted" id="tm-progress" style="margin-top:10px;min-height:1.2em;"></div>';
    openModal('Send to Fusion Model', body, [
        { label: 'Cancel', cls: 'ghost', onClick: closeModal },
        { label: '<i class="fa-solid fa-cubes-stacked"></i> Send to Fusion Model', cls: 'primary', onClick: function () { if (isAdmin) tmSend(this, R); else toast('Only an AI admin can do this', 'warn'); } }
    ], true);
    $('tm-mod').onchange = function () { $('tm-newmod').style.display = this.value === '__new' ? '' : 'none'; };
    document.querySelectorAll('input[name="tm-strat"]').forEach(function (r) {
        r.onchange = function () { $('tm-inc').style.display = this.value === 'incremental' ? '' : 'none'; $('tm-win').style.display = this.value === 'window' ? '' : 'none'; };
    });
    $('tm-name').onblur = function () { this.value = tmIdent(this.value); };
}

/** The query with the parameter values it ran with, without a trailing semicolon. */
function tmSql(R) {
    var sql = R.source.sql, p = R.source.params || {};
    if (Object.keys(p).length && typeof substituteParams === 'function') sql = substituteParams(sql, p);
    return sql.trim().replace(/;+\s*$/, '');
}

function tmSend(btn, R) {
    var modSel = $('tm-mod').value, module = modSel === '__new' ? tmIdent($('tm-modname').value, 'fusion_sql') : modSel;
    var name = tmIdent($('tm-name').value), strat = (document.querySelector('input[name="tm-strat"]:checked') || {}).value || 'full';
    var key = $('tm-key').value;
    var types = {}; document.querySelectorAll('[data-tmc]').forEach(function (s) { types[s.dataset.tmc] = s.value; });
    var table = {
        module: module, name: name, description: $('tm-desc').value.trim() || ('From Fusion SQL' + (FS.currentQuery ? ': ' + FS.currentQuery.name : '')),
        source: { kind: $('tm-src').value, sql: tmSql(R) }, strategy: strat, key: key ? [key] : [], columnTypes: types
    };
    if (strat === 'incremental') {
        if (!key) { toast('Incremental loads need a key column', 'warn'); return; }
        table.incrementalColumn = $('tm-inccol').value; table.overlapMinutes = 60;
    }
    if (strat === 'window') { table.windowColumn = $('tm-wincol').value; table.windowMonths = Math.max(1, Math.min(120, +$('tm-months').value || 3)); }
    var exists = (TM.model.tables || []).some(function (t) { return t.module === module && t.name === name; });
    if (exists && !confirm('The Fusion Model already has ' + module + '.' + name + '. Replace its definition with this query?')) return;
    var refresh = $('tm-now').checked;
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ' + (refresh ? 'Adding and loading…' : 'Adding…');
    var prog = $('tm-progress');
    TM.onProgress = function (m) { if (prog) prog.textContent = m; };
    fsCall('fmAddTable', { table: table, moduleTitle: modSel === '__new' ? 'Fusion SQL' : null, replace: exists, refresh: refresh, appUser: appUserName() }).then(function (r) {
        TM.onProgress = null;
        if (r && r.ok === false) throw r.error;
        closeModal();
        var where = module + '.' + name;
        openModal('Sent to the Fusion Model', '<p><i class="fa-solid fa-circle-check" style="color:#15803d"></i> <b>' + esc(where) + '</b> is in the Fusion Model' +
            (refresh ? ' and loaded' + (r.loaded != null ? ' — <b>' + Number(r.loaded).toLocaleString() + '</b> rows' : '') + '.' : '. It loads with the module\'s next refresh.') + '</p>' +
            '<p class="fs-muted">Query it in Explore as <code>SELECT * FROM ' + esc(where) + '</code>, add measures on it in Model, or use it in Reports and Dashboards.</p>', [
            { label: 'Close', cls: 'ghost', onClick: closeModal },
            { label: '<i class="fa-solid fa-arrow-up-right-from-square"></i> Open in Fusion Model', cls: 'primary', onClick: function () { location.href = '../fusionmodel/index.html?tab=explore&sql=' + encodeURIComponent('SELECT * FROM ' + where + ' LIMIT 100'); } }
        ]);
    }).catch(function (e) {
        TM.onProgress = null;
        btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-cubes-stacked"></i> Send to Fusion Model';
        if (prog) prog.innerHTML = '<span style="color:#b91c1c;"><i class="fa-solid fa-triangle-exclamation"></i> ' + esc(e) + '</span>';
    });
}
