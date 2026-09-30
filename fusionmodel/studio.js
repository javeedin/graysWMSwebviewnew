/* Fusion Model — Model tab (Model Studio): relationships, measures (DAX-compatible, tested live), calendar and
   row-level security. Edits S.model (saved with fmModelSave); measures are checked with fmValidate and tried with
   fmEvaluate. Column lists come from the published files (information_schema) plus the generated calendar. */

var CAL_COLS = ['Date', 'Year', 'Quarter', 'QuarterName', 'Month', 'MonthName', 'YearMonth', 'MonthStart', 'Day', 'Weekday', 'WeekdayName', 'IsWeekend', 'FiscalYear', 'FiscalQuarter', 'FiscalMonth', 'FiscalYearStart'];
var ST = { sec: 'measures', cur: null, errors: {}, test: null, testBy: '' };

/** module.table → [columns] from the published files, plus the calendar. */
function modelColumns() {
    var map = {};
    (S.schema || []).forEach(function (r) { if (r[0] === 'memory' || r[0] === 'system' || r[0] === 'temp') return; var k = r[0] + '.' + r[1]; (map[k] = map[k] || []).push(r[2]); });
    if (!S.model.calendar || S.model.calendar.enabled !== false) map.calendar = CAL_COLS.slice();
    return map;
}
function tableKeys() { return Object.keys(modelColumns()).sort(); }
/** A table name as measures write it: the bare name when unique, else 'module.table'. */
function daxTable(key) {
    if (key === 'calendar') return "'calendar'";
    var name = key.split('.').pop();
    var dup = tableKeys().filter(function (k) { return k.split('.').pop() === name; }).length > 1;
    return dup ? "'" + key + "'" : name;
}
function studioModel() {
    var m = S.model;
    m.relationships = m.relationships || []; m.measures = m.measures || []; m.roles = m.roles || []; m.glossary = m.glossary || [];
    m.calendar = m.calendar || { enabled: true, startYear: 0, endYear: 0, fiscalYearStartMonth: 1 };
    return m;
}

function renderStudio() {
    if (!S.model) return;
    var go = S.schema.length ? Promise.resolve() : loadSchema();
    go.then(function () {
        var m = studioModel();
        $('studio-nav').innerHTML = [['measures', 'fa-calculator', 'Measures', m.measures.length], ['relationships', 'fa-diagram-project', 'Relationships', m.relationships.length],
            ['calendar', 'fa-calendar-days', 'Calendar', ''], ['security', 'fa-user-shield', 'Security', m.roles.length],
            ['glossary', 'fa-book', 'Glossary', m.glossary.length], ['docs', 'fa-align-left', 'Descriptions', '']].map(function (x) {
            return '<button class="ritem' + (ST.sec === x[0] ? ' on' : '') + '" data-sec="' + x[0] + '"><i class="fa-solid ' + x[1] + '"></i><span><b>' + x[2] + '</b>' +
                (x[3] !== '' ? '<small>' + x[3] + '</small>' : '') + '</span></button>';
        }).join('') + '<div class="studio-foot"><button class="btn primary block" data-act="save"' + (S.isAdmin ? '' : ' disabled') + '><i class="fa-solid fa-floppy-disk"></i> Save model' + (S.dirty ? ' *' : '') + '</button>' +
            '<button class="btn block" data-act="validate"><i class="fa-solid fa-spell-check"></i> Check all measures</button></div>';
        ({ measures: renderMeasures, relationships: renderRelationships, calendar: renderCalendar, security: renderSecurity, glossary: renderGlossary, docs: renderDocs })[ST.sec]();
    });
}

// ── measures ───────────────────────────────────────────────────
function renderMeasures() {
    var m = studioModel(), keys = tableKeys();
    if (ST.cur == null && m.measures.length) ST.cur = 0;
    var byTable = {};
    m.measures.forEach(function (x, i) { (byTable[x.table || '(no table)'] = byTable[x.table || '(no table)'] || []).push(i); });
    var list = Object.keys(byTable).sort().map(function (t) {
        return '<div class="rgroup">' + esc(t) + '</div>' + byTable[t].map(function (i) {
            var x = m.measures[i], err = ST.errors[x.name];
            return '<button class="ritem' + (ST.cur === i ? ' on' : '') + '" data-mi="' + i + '"><i class="fa-solid ' + (err ? 'fa-triangle-exclamation' : 'fa-calculator') + '"' + (err ? ' style="color:#b91c1c"' : '') + '></i><span><b>' + esc(x.name || '(unnamed)') + '</b><small>' + esc(x.folder || x.format || '') + '</small></span></button>';
        }).join('');
    }).join('');
    var x = m.measures[ST.cur];
    var editor = !x ? '<div class="empty"><h2>No measure selected</h2><p>Measures are calculations like <b>Sales = SUM(lines[AMOUNT])</b>, written in a DAX-compatible language. Filters, CALCULATE and time intelligence work as in Power BI.</p></div>'
        : '<div class="card"><div class="row"><label class="fld"><span>Name</span><input data-mf2="name" value="' + esc(x.name || '') + '"></label>' +
          '<label class="fld"><span>Home table</span><select data-mf2="table">' + keys.map(function (k) { return '<option' + (k === x.table ? ' selected' : '') + '>' + esc(k) + '</option>'; }).join('') + '</select></label>' +
          '<label class="fld" style="max-width:140px"><span>Format</span><input data-mf2="format" value="' + esc(x.format || '') + '" placeholder="#,0.00 · 0.0%"></label>' +
          '<label class="fld" style="max-width:180px"><span>Folder</span><input data-mf2="folder" value="' + esc(x.folder || '') + '"></label></div>' +
          '<textarea class="dax" data-mf2="expression" spellcheck="false" rows="' + Math.max(4, String(x.expression || '').split('\n').length + 1) + '" placeholder="CALCULATE(SUM(lines[AMOUNT]), SAMEPERIODLASTYEAR(\'calendar\'[Date]))">' + esc(x.expression || '') + '</textarea>' +
          (ST.errors[x.name] ? '<p class="err sm"><i class="fa-solid fa-triangle-exclamation"></i> ' + esc(ST.errors[x.name]) + '</p>' : '') +
          '<input data-mf2="description" value="' + esc(x.description || '') + '" placeholder="What it means (people and the AI read this)" class="desc">' +
          '<input data-mf2="synonyms" value="' + esc((x.synonyms || []).join(', ')) + '" placeholder="Other names people use: revenue, turnover (comma separated)" class="desc">' +
          '<div class="row"><label class="fld"><span>Try it by</span><select id="st-by"><option value="">(total only)</option>' + keys.map(function (k) {
              return '<optgroup label="' + esc(k) + '">' + (modelColumns()[k] || []).map(function (c) { var v = daxTable(k) + '[' + c + ']'; return '<option value="' + esc(v) + '"' + (ST.testBy === v ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</optgroup>';
          }).join('') + '</select></label>' +
          '<button class="btn primary" data-act="mtest" style="align-self:end"><i class="fa-solid fa-play"></i> Try</button>' +
          '<button class="btn" data-act="mdel" style="align-self:end;margin-left:auto;color:#b91c1c"' + (S.isAdmin ? '' : ' disabled') + '><i class="fa-solid fa-trash"></i></button></div>' +
          '<div id="st-test" class="grid mini"></div></div>' +
          '<div class="card help"><b>Cheat sheet</b><div class="sm muted">' +
          'SUM · AVERAGE · MIN · MAX · COUNTROWS · DISTINCTCOUNT · SUMX(table, expr) · AVERAGEX · RANKX(ALL(t[c]), [M]) · ' +
          'CALCULATE([M], t[c] = "x", ALL(t), ALLEXCEPT(t, t[c]), KEEPFILTERS(…), FILTER(VALUES(t[c]), [M] &gt; 100), USERELATIONSHIP(a, b)) · ' +
          'TOTALYTD([M], \'calendar\'[Date]) · SAMEPERIODLASTYEAR · DATEADD(…, -1, MONTH) · DATESINPERIOD(…, MAX(\'calendar\'[Date]), -12, MONTH) · PARALLELPERIOD · ' +
          'DIVIDE(a, b) · IF · SWITCH(TRUE(), …) · SELECTEDVALUE · VAR x = … RETURN …</div></div>';
    $('studio-main').innerHTML = '<div class="studio-split"><div class="studio-list"><button class="btn sm block" data-act="madd"' + (S.isAdmin ? '' : ' disabled') + '><i class="fa-solid fa-plus"></i> New measure</button>' + (list || '<div class="muted pad">No measures yet.</div>') + '</div><div class="studio-edit">' + editor + '</div></div>';
    if (x && ST.test && ST.test.name === x.name) renderTest(ST.test.result);
}
function testMeasure() {
    var x = studioModel().measures[ST.cur]; if (!x) return;
    ST.testBy = $('st-by').value;
    $('st-test').innerHTML = '<div class="muted pad"><i class="fa-solid fa-circle-notch fa-spin"></i> Running…</div>';
    // every measure as it is in the editor (saved or not), so a new measure can use other new ones
    var defs = studioModel().measures.filter(function (y) { return y.name && y.expression; }).map(function (y) {
        return 'MEASURE ' + daxTable(y.table || 'calendar') + '[' + y.name.replace(/\]/g, ']]') + '] = ' + y.expression;
    }).join('\n');
    var text = 'DEFINE ' + defs + '\nEVALUATE ' + (ST.testBy ? 'SUMMARIZECOLUMNS(' + ST.testBy + ', "' + (x.name || 'Test').replace(/"/g, '""') + '", [' + (x.name || 'Test') + '])' : 'ROW("' + (x.name || 'Test').replace(/"/g, '""') + '", [' + (x.name || 'Test') + '])');
    fm('fmEvaluateText', { text: text }).then(function (d) { ST.test = { name: x.name, result: d.result }; delete ST.errors[x.name]; renderTest(d.result); })
        .catch(function (e) { $('st-test').innerHTML = '<div class="err pad">' + esc(e) + '</div>'; });
}
function renderTest(r) {
    var el = $('st-test'); if (!el) return;
    var fmt = (studioModel().measures[ST.cur] || {}).format;
    el.innerHTML = '<table><thead><tr>' + r.columns.map(function (c) { return '<th>' + esc(c.name) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        r.rows.slice(0, 200).map(function (row) { return '<tr>' + row.map(function (v, i) { return '<td' + (r.columns[i].role === 'measure' ? ' class="n"' : '') + '>' + (v == null ? '<span class="null">blank</span>' : esc(r.columns[i].role === 'measure' ? fmtValue(v, fmt) : v)) + '</td>'; }).join('') + '</tr>'; }).join('') +
        '</tbody></table><div class="muted sm pad">' + r.rows.length + ' rows · ' + r.ms + ' ms <a href="#" data-act="showsql">SQL</a></div><pre class="sqlbox" id="st-sql" hidden>' + esc(r.sql || '') + '</pre>';
}
/** #,0 · #,0.00 · 0.0% · 0% */
function fmtValue(v, f) {
    if (typeof v !== 'number') return v;
    if (!f) return v.toLocaleString(undefined, { maximumFractionDigits: 4 });
    var dec = (f.split('.')[1] || '').replace(/[^0#]/g, '').length;
    if (/%$/.test(f)) return (v * 100).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec }) + '%';
    return v.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: f.indexOf(',') >= 0 });
}

// ── relationships ──────────────────────────────────────────────
function renderRelationships() {
    var m = studioModel(), cols = modelColumns(), keys = tableKeys();
    function tsel(i, f, v) { return '<select data-ri="' + i + '" data-rf="' + f + '">' + keys.map(function (k) { return '<option' + (k === v ? ' selected' : '') + '>' + esc(k) + '</option>'; }).join('') + '</select>'; }
    function csel(i, f, t, v) { return '<select data-ri="' + i + '" data-rf="' + f + '">' + (cols[t] || []).map(function (c) { return '<option' + (c === v ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>'; }
    $('studio-main').innerHTML = '<div class="card"><div class="mh"><b>Relationships</b><small class="muted">from the many side (e.g. invoice lines) to the one side with unique values (suppliers, calendar). Filters flow one → many.</small>' +
        '<button class="btn sm" data-act="rsuggest"><i class="fa-solid fa-wand-magic-sparkles"></i> Suggest</button><button class="btn sm" data-act="radd"><i class="fa-solid fa-plus"></i></button></div>' +
        (m.relationships.length ? '<table class="tbl-log rel"><tr><th>From (many)</th><th></th><th>To (one)</th><th></th><th>Active</th><th>Filter</th><th></th></tr>' + m.relationships.map(function (r, i) {
            return '<tr><td>' + tsel(i, 'fromTable', r.fromTable) + '</td><td>' + csel(i, 'fromColumn', r.fromTable, r.fromColumn) + '</td><td>' + tsel(i, 'toTable', r.toTable) + '</td><td>' + csel(i, 'toColumn', r.toTable, r.toColumn) + '</td>' +
                '<td><input type="checkbox" data-ri="' + i + '" data-rf="active"' + (r.active !== false ? ' checked' : '') + '></td>' +
                '<td><select data-ri="' + i + '" data-rf="crossFilter"><option value="single"' + (r.crossFilter !== 'both' ? ' selected' : '') + '>one way</option><option value="both"' + (r.crossFilter === 'both' ? ' selected' : '') + '>both ways</option></select></td>' +
                '<td><button class="btn sm" data-act="rdel" data-ri="' + i + '"><i class="fa-solid fa-xmark"></i></button></td></tr>';
        }).join('') + '</table>' : '<p class="muted">No relationships. <b>Suggest</b> finds them from matching key columns and links date columns to the calendar.</p>') +
        '<p class="muted sm">Only one active path between two tables; use <code>USERELATIONSHIP(from, to)</code> in a measure to use an inactive one (e.g. ship date instead of order date).</p></div>';
}
/** Matching column names where the other table has that column as its key; date-like columns → calendar[Date] (inactive after the first). */
function suggestRelationships() {
    var m = studioModel(), cols = modelColumns(), found = 0;
    var keyOf = {}; (m.tables || []).forEach(function (t) { keyOf[t.module + '.' + t.name] = (t.key || []).map(function (k) { return k.toUpperCase(); }); });
    var exists = function (a, b, c, d) { return m.relationships.some(function (r) { return r.fromTable === a && r.fromColumn.toUpperCase() === b.toUpperCase() && r.toTable === c && r.toColumn === d; }); };
    Object.keys(cols).forEach(function (from) {
        if (from === 'calendar') return;
        var dateLinked = m.relationships.some(function (r) { return r.fromTable === from && r.toTable === 'calendar' && r.active !== false; });
        cols[from].forEach(function (c) {
            Object.keys(keyOf).forEach(function (to) {
                if (to === from || keyOf[to].length !== 1 || keyOf[to][0] !== c.toUpperCase()) return;
                if ((keyOf[from] || []).length === 1 && keyOf[from][0] === c.toUpperCase()) return;     // both keyed on it: not many→one
                var toCol = (cols[to] || []).find(function (x) { return x.toUpperCase() === c.toUpperCase(); });
                if (toCol && !exists(from, c, to, toCol)) { m.relationships.push({ fromTable: from, fromColumn: c, toTable: to, toColumn: toCol, active: true, crossFilter: 'single' }); found++; }
            });
            var typ = ((S.schema || []).find(function (r) { return r[0] + '.' + r[1] === from && r[2] === c; }) || [])[3] || '';
            if ((/^(DATE|TIMESTAMP)/i.test(typ) || /(_DATE|DATE_|^DATE$|DATE$)/i.test(c)) && !exists(from, c, 'calendar', 'Date')) {
                m.relationships.push({ fromTable: from, fromColumn: c, toTable: 'calendar', toColumn: 'Date', active: !dateLinked, crossFilter: 'single' });
                dateLinked = true; found++;
            }
        });
    });
    markDirty(); renderStudio();
    toast(found ? found + ' relationship(s) suggested — check them, then Save model' : 'Nothing new to suggest');
}

// ── calendar + security ────────────────────────────────────────
function renderCalendar() {
    var c = studioModel().calendar;
    var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    $('studio-main').innerHTML = '<div class="card"><h3><i class="fa-solid fa-calendar-days"></i> Calendar</h3>' +
        '<p class="muted sm">A date table named <code>calendar</code> is generated in every query session: one row per day with Year, Quarter, Month, MonthName, YearMonth, Weekday and fiscal columns. Link date columns to <code>calendar[Date]</code> in Relationships to use time intelligence.</p>' +
        '<label class="chk"><input type="checkbox" data-cf="enabled"' + (c.enabled !== false ? ' checked' : '') + '> Generate the calendar</label>' +
        '<div class="row"><label class="fld" style="max-width:160px"><span>First year</span><input type="number" data-cf="startYear" value="' + (c.startYear || '') + '" placeholder="5 years back"></label>' +
        '<label class="fld" style="max-width:160px"><span>Last year</span><input type="number" data-cf="endYear" value="' + (c.endYear || '') + '" placeholder="next year"></label>' +
        '<label class="fld" style="max-width:220px"><span>Fiscal year starts in</span><select data-cf="fiscalYearStartMonth">' + months.map(function (x, i) { return '<option value="' + (i + 1) + '"' + ((c.fiscalYearStartMonth || 1) === i + 1 ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select></label></div>' +
        '<p class="muted sm">FiscalYear is named by the year it ends in (a July start: July 2025 – June 2026 = FY 2026). For fiscal year-to-date use <code>TOTALYTD([M], \'calendar\'[Date], "06-30")</code>.</p></div>';
}
function renderSecurity() {
    var m = studioModel(), keys = tableKeys().filter(function (k) { return k !== 'calendar'; }), cols = modelColumns();
    $('studio-main').innerHTML = '<div class="card"><div class="mh"><b>Row-level security</b><small class="muted">members of a role see only the rows its filters allow — in Explore, reports, exports and the AI. Users in no role see everything unless a role lists "*".</small><button class="btn sm" data-act="roleadd"><i class="fa-solid fa-plus"></i> Role</button></div>' +
        (m.roles.length ? m.roles.map(function (r, i) {
            return '<div class="card role"><div class="row"><label class="fld"><span>Role</span><input data-rol="' + i + '" data-rolf="name" value="' + esc(r.name || '') + '"></label>' +
                '<label class="fld grow"><span>Members (app logins, comma separated; * = everyone else)</span><input data-rol="' + i + '" data-rolf="members" value="' + esc((r.members || []).join(', ')) + '"></label>' +
                '<button class="btn sm" data-act="roledel" data-rol="' + i + '" style="align-self:end"><i class="fa-solid fa-trash"></i></button></div>' +
                (r.filters || []).map(function (f, j) {
                    return '<div class="row"><select data-rol="' + i + '" data-rfi="' + j + '" data-rolf="table">' + keys.map(function (k) { return '<option' + (k === f.table ? ' selected' : '') + '>' + esc(k) + '</option>'; }).join('') + '</select>' +
                        '<select data-rol="' + i + '" data-rfi="' + j + '" data-rolf="column">' + (cols[f.table] || []).map(function (c) { return '<option' + (c === f.column ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' +
                        '<input class="grow" data-rol="' + i + '" data-rfi="' + j + '" data-rolf="values" value="' + esc((f.values || []).join(', ')) + '" placeholder="allowed values, comma separated">' +
                        '<button class="btn sm" data-act="rfdel" data-rol="' + i + '" data-rfi="' + j + '"><i class="fa-solid fa-xmark"></i></button></div>';
                }).join('') + '<button class="btn sm" data-act="rfadd" data-rol="' + i + '"><i class="fa-solid fa-plus"></i> Filter</button></div>';
        }).join('') : '<p class="muted">No roles: everyone sees all rows.</p>') + '</div>';
}

// ── glossary ───────────────────────────────────────────────────
function csvList(v) { return String(v || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean); }
function renderGlossary() {
    var g = studioModel().glossary;
    $('studio-main').innerHTML = '<div class="card"><div class="mh"><b>Glossary</b><small class="muted">the words your business uses and what they mean in the model — search and the AI read these. A rule is followed whenever the term is used.</small>' +
        '<button class="btn sm" data-act="gadd"><i class="fa-solid fa-plus"></i> Term</button></div>' +
        (g.length ? g.map(function (t, i) {
            return '<div class="card role"><div class="row"><label class="fld" style="max-width:220px"><span>Term</span><input data-gi="' + i + '" data-gf="term" value="' + esc(t.term || '') + '" placeholder="Backlog"></label>' +
                '<label class="fld grow"><span>Also called (comma separated)</span><input data-gi="' + i + '" data-gf="synonyms" value="' + esc((t.synonyms || []).join(', ')) + '" placeholder="order book, open orders"></label>' +
                '<button class="btn sm" data-act="gdel" data-gi="' + i + '" style="align-self:end"><i class="fa-solid fa-trash"></i></button></div>' +
                '<label class="fld"><span>Definition</span><input data-gi="' + i + '" data-gf="definition" value="' + esc(t.definition || '') + '" placeholder="Orders received but not shipped yet"></label>' +
                '<div class="row"><label class="fld grow"><span>Means (measures, table[COLUMN] or module.table — comma separated)</span><input data-gi="' + i + '" data-gf="refs" value="' + esc((t.refs || []).join(', ')) + '" placeholder="[Open Orders], sales.lines[STATUS]"></label>' +
                '<label class="fld grow"><span>Rule for the AI</span><input data-gi="' + i + '" data-gf="rule" value="' + esc(t.rule || '') + '" placeholder="Exclude cancelled lines"></label></div></div>';
        }).join('') : '<p class="muted">No terms yet. Add the words people ask with — "DSO", "backlog", "fill rate" — and point them at measures.</p>') + '</div>';
}

// ── descriptions (tables and columns) ──────────────────────────
function renderDocs() {
    var m = studioModel(), cols = modelColumns();
    var tabs = m.tables.map(function (t, i) { return { t: t, i: i, key: t.module + '.' + t.name }; });
    if (ST.docT == null || !tabs[ST.docT]) ST.docT = 0;
    var cur = tabs[ST.docT];
    $('studio-main').innerHTML = !cur ? '<div class="empty"><h2>No tables yet</h2></div>' :
        '<div class="card"><div class="row"><label class="fld" style="max-width:320px"><span>Table</span><select id="doc-t">' + tabs.map(function (x) { return '<option value="' + x.i + '"' + (x.i === cur.i ? ' selected' : '') + '>' + esc(x.key) + '</option>'; }).join('') + '</select></label>' +
        '<label class="fld grow"><span>Also called</span><input data-dt="synonyms" value="' + esc((cur.t.synonyms || []).join(', ')) + '" placeholder="clients, accounts"></label></div>' +
        '<label class="fld"><span>Description</span><input data-dt="description" value="' + esc(cur.t.description || '') + '"></label>' +
        '<table class="doc-cols"><thead><tr><th>Column</th><th>Description</th><th>Also called</th></tr></thead><tbody>' +
        (cols[cur.key] || []).map(function (c) {
            var d = (cur.t.columns || {})[c] || {};
            return '<tr><td><code>' + esc(c) + '</code></td><td><input data-dc="' + esc(c) + '" data-dcf="description" value="' + esc(d.description || '') + '"></td>' +
                '<td><input data-dc="' + esc(c) + '" data-dcf="synonyms" value="' + esc((d.synonyms || []).join(', ')) + '"></td></tr>';
        }).join('') + '</tbody></table>' + (!(cols[cur.key] || []).length ? '<p class="muted sm">Refresh the module first — columns come from the published file.</p>' : '') + '</div>';
}

// ── events (studio only) ───────────────────────────────────────
document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-sec], [data-mi], button, a[data-act]');
    if (!b || !$('page-model') || $('page-model').hidden) return;
    var d = b.dataset, m = S.model && studioModel();
    if (d.sec) { ST.sec = d.sec; ST.cur = null; return renderStudio(); }
    if (d.mi != null) { ST.cur = +d.mi; return renderMeasures(); }
    switch (d.act) {
        case 'madd': m.measures.push({ table: tableKeys().filter(function (k) { return k !== 'calendar'; })[0] || 'calendar', name: 'New measure', expression: '' }); ST.cur = m.measures.length - 1; markDirty(); return renderStudio();
        case 'mdel': if (confirm('Delete measure ' + m.measures[ST.cur].name + '?')) { m.measures.splice(ST.cur, 1); ST.cur = null; markDirty(); renderStudio(); } return;
        case 'mtest': return testMeasure();
        case 'showsql': e.preventDefault(); var sq = $('st-sql'); if (sq) sq.hidden = !sq.hidden; return;
        case 'validate':
            if (S.dirty) { toast('Save the model first, then check'); return; }
            return fm('fmValidate').then(function (r) {
                ST.errors = r.errors || {}; var n = Object.keys(ST.errors).length;
                toast(n ? n + ' measure(s) have errors — marked in red' : 'All ' + m.measures.length + ' measures compile'); renderStudio();
            }).catch(function (x) { toast(String(x)); });
        case 'radd': var k = tableKeys(); m.relationships.push({ fromTable: k[0], fromColumn: (modelColumns()[k[0]] || [])[0], toTable: 'calendar', toColumn: 'Date', active: true, crossFilter: 'single' }); markDirty(); return renderStudio();
        case 'rdel': m.relationships.splice(+d.ri, 1); markDirty(); return renderStudio();
        case 'rsuggest': return suggestRelationships();
        case 'roleadd': m.roles.push({ name: 'New role', members: [], filters: [] }); markDirty(); return renderStudio();
        case 'roledel': m.roles.splice(+d.rol, 1); markDirty(); return renderStudio();
        case 'rfadd': var t0 = tableKeys().filter(function (k) { return k !== 'calendar'; })[0]; m.roles[+d.rol].filters.push({ table: t0, column: (modelColumns()[t0] || [])[0], values: [] }); markDirty(); return renderStudio();
        case 'rfdel': m.roles[+d.rol].filters.splice(+d.rfi, 1); markDirty(); return renderStudio();
        case 'gadd': m.glossary.push({ term: '', synonyms: [], definition: '', refs: [], rule: '' }); markDirty(); return renderStudio();
        case 'gdel': m.glossary.splice(+d.gi, 1); markDirty(); return renderStudio();
    }
});
document.addEventListener('input', function (e) {
    var x = e.target, d = x.dataset;
    if (!S.model || !$('page-model') || $('page-model').hidden) return;
    var m = studioModel();
    if (d.mf2 === 'synonyms' && m.measures[ST.cur]) { m.measures[ST.cur].synonyms = csvList(x.value); markDirty(); return; }
    if (d.mf2 && m.measures[ST.cur]) { m.measures[ST.cur][d.mf2] = x.value; markDirty(); if (d.mf2 === 'name') renderMeasures(); return; }
    if (d.gf != null && m.glossary[+d.gi]) { var gt = m.glossary[+d.gi]; gt[d.gf] = d.gf === 'synonyms' || d.gf === 'refs' ? csvList(x.value) : x.value; markDirty(); return; }
    if (d.dt || d.dc) {
        var tb = m.tables[ST.docT]; if (!tb) return;
        if (d.dt) tb[d.dt] = d.dt === 'synonyms' ? csvList(x.value) : x.value;
        else { tb.columns = tb.columns || {}; var cd = tb.columns[d.dc] = tb.columns[d.dc] || {}; cd[d.dcf] = d.dcf === 'synonyms' ? csvList(x.value) : x.value; }
        markDirty(); return;
    }
    if (d.cf) { var c = m.calendar; if (d.cf === 'enabled') c.enabled = x.checked; else c[d.cf] = +x.value || 0; markDirty(); return; }
    if (d.rol != null) {
        var r = m.roles[+d.rol];
        if (d.rfi != null) { var f = r.filters[+d.rfi]; if (d.rolf === 'values') f.values = x.value.split(',').map(function (v) { return v.trim(); }).filter(Boolean); else f[d.rolf] = x.value; if (d.rolf === 'table') renderStudio(); }
        else if (d.rolf === 'members') r.members = x.value.split(',').map(function (v) { return v.trim(); }).filter(Boolean);
        else r[d.rolf] = x.value;
        markDirty();
    }
});
document.addEventListener('change', function (e) {
    var x = e.target, d = x.dataset;
    if (!S.model || !$('page-model') || $('page-model').hidden) return;
    var m = studioModel();
    if (d.ri != null) {
        var r = m.relationships[+d.ri];
        if (d.rf === 'active') r.active = x.checked; else r[d.rf] = x.value;
        if (d.rf === 'fromTable') r.fromColumn = (modelColumns()[x.value] || [])[0];
        if (d.rf === 'toTable') r.toColumn = (modelColumns()[x.value] || [])[0];
        markDirty(); if (d.rf === 'fromTable' || d.rf === 'toTable') renderStudio();
    }
    if (x.id === 'doc-t') { ST.docT = +x.value; return renderDocs(); }
    if (d.mf2 === 'table' && m.measures[ST.cur]) { m.measures[ST.cur].table = x.value; markDirty(); renderMeasures(); }
    if (d.cf === 'enabled' || d.cf === 'fiscalYearStartMonth') { m.calendar[d.cf] = d.cf === 'enabled' ? x.checked : +x.value; markDirty(); }
    if (d.rolf === 'table' || d.rolf === 'column') { var rr = m.roles[+d.rol].filters[+d.rfi]; rr[d.rolf] = x.value; if (d.rolf === 'table') rr.column = (modelColumns()[x.value] || [])[0]; markDirty(); renderStudio(); }
});
