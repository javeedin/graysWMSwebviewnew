/* AI Agent — the Code tab: write / paste code, run it on this PC, save it to run again later.
   Languages: Python, C#, JavaScript, PowerShell (classes/CodeRunner.cs runs each in its own process; missing runtimes
   are downloaded with one click). Only AI admins run code; every run is audited. Saved code lives in APEX
   (WMS_AI_CODE_SNIPPETS, apex_sql/83_ai_code_snippets.sql, created here on first use) so it can be opened and run
   again from any PC — and the agent can list it (tool saved_code) and run it (tool run_code, always a confirm card).
   Data in: pick a result → input.csv. Data out: print → Output, output.csv → a table (send it to the results panel),
   *.png → shown (e.g. a matplotlib chart). */

var CODE = window.CODE = { cur: null, list: [], runtimes: [], admin: false };

CODE.LANGS = {
    python: { label: 'Python', ext: 'py', icon: 'fa-brands fa-python', sample: '# input.csv = the result you picked (if any); write output.csv for a table, *.png for charts\nimport pandas as pd, os\n\nif os.path.exists("input.csv"):\n    df = pd.read_csv("input.csv")\n    print(df.describe(include="all"))\n    df.head(20).to_csv("output.csv", index=False)\nelse:\n    print("Hello from Python")\n' },
    csharp: { label: 'C#', ext: 'cs', icon: 'fa-solid fa-hashtag', sample: '// top-level statements (.NET 8). input.csv / output.csv work the same way.\nusing System.IO;\n\nif (File.Exists("input.csv"))\n{\n    var lines = File.ReadAllLines("input.csv");\n    Console.WriteLine($"{lines.Length - 1} rows, columns: {lines[0]}");\n}\nelse Console.WriteLine("Hello from C#");\n' },
    javascript: { label: 'JavaScript', ext: 'js', icon: 'fa-brands fa-node-js', sample: '// Node.js. input.csv / output.csv work the same way.\nconst fs = require("fs");\nif (fs.existsSync("input.csv")) {\n  const rows = fs.readFileSync("input.csv", "utf8").trim().split(/\\r?\\n/);\n  console.log(rows.length - 1, "rows");\n} else console.log("Hello from Node.js");\n' },
    powershell: { label: 'PowerShell', ext: 'ps1', icon: 'fa-solid fa-terminal', sample: '# Windows PowerShell. input.csv / output.csv work the same way.\nif (Test-Path input.csv) { $d = Import-Csv input.csv; "{0} rows" -f $d.Count }\nelse { "Hello from PowerShell on $env:COMPUTERNAME" }\n' }
};

// ── tabs ──
CODE.showTab = function (tab) {
    document.querySelectorAll('.ag-tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === tab); });
    document.querySelector('.shell').hidden = tab !== 'chat';
    $('codews').hidden = tab !== 'code';
    try { localStorage.setItem('aiagent.tab', tab); } catch (e) { /* private mode */ }
    if (tab === 'code' && !CODE.started) CODE.start();
};
CODE.cmd = function (a) { return host(a.action, a, a.action === 'codeRun' ? 900000 : a.action === 'codeInstall' ? 30000 : 60000); };

CODE.start = function () {
    CODE.started = true;
    var ws = $('codews');
    ws.innerHTML =
        '<aside class="cw-side"><div class="row"><b class="grow">Saved code</b><button class="btn sm primary" onclick="CODE.newCode()"><i class="fa-solid fa-plus"></i> New</button></div>' +
        '<input type="text" id="cw-filter" placeholder="Search saved code…"><div id="cw-list" class="cw-list"></div>' +
        '<div class="side-h" style="margin-top:12px">Languages on this PC</div><div id="cw-rt" class="cw-rt"></div></aside>' +
        '<section class="cw-main"><div class="cw-bar">' +
        '<input type="text" id="cw-name" placeholder="Name (to save it)" class="grow">' +
        '<select id="cw-lang">' + Object.keys(CODE.LANGS).map(function (k) { return '<option value="' + k + '">' + CODE.LANGS[k].label + '</option>'; }).join('') + '</select>' +
        '<button class="btn" onclick="CODE.save()" title="Save (Ctrl+S)"><i class="fa-regular fa-floppy-disk"></i> Save</button>' +
        '<button class="btn primary" id="cw-run" onclick="CODE.run()" title="Run (Ctrl+Enter)"><i class="fa-solid fa-play"></i> Run</button>' +
        '<button class="btn" onclick="CODE.askAi()" title="Send this code to the chat"><i class="fa-regular fa-comment"></i> Ask AI</button></div>' +
        '<div class="cw-bar2"><input type="text" id="cw-desc" placeholder="What it does (shown in the list and to the agent)" class="grow">' +
        '<input type="text" id="cw-pkgs" placeholder="Packages (pip / NuGet), comma" title="Python: pip packages · C#: NuGet packages (Name or Name=1.2.3)">' +
        '<select id="cw-input" title="Gives the code a table as input.csv"><option value="">No input data</option></select>' +
        '<label class="sm muted">Limit <input type="number" id="cw-timeout" value="60" min="5" max="600" style="width:58px"> s</label></div>' +
        '<div class="cw-editor"><pre class="cw-gutter" id="cw-gutter">1</pre><textarea id="cw-code" spellcheck="false" wrap="off"></textarea></div>' +
        '<div class="cw-out"><div class="cw-out-tabs" id="cw-otabs"></div><div class="cw-out-body" id="cw-obody"><p class="muted sm">Run the code to see its output here.</p></div></div></section>';
    var ta = $('cw-code');
    ta.addEventListener('input', CODE.gutter);
    ta.addEventListener('scroll', function () { $('cw-gutter').scrollTop = ta.scrollTop; });
    ta.addEventListener('keydown', function (e) {
        if (e.key === 'Tab') { e.preventDefault(); var s = ta.selectionStart; ta.setRangeText('    ', s, ta.selectionEnd, 'end'); CODE.gutter(); }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); CODE.run(); }
        if ((e.key === 's' || e.key === 'S') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); CODE.save(); }
    });
    $('cw-lang').onchange = function () { if (!ta.value.trim() || Object.keys(CODE.LANGS).some(function (k) { return ta.value === CODE.LANGS[k].sample; })) { ta.value = CODE.LANGS[this.value].sample; CODE.gutter(); } };
    $('cw-filter').oninput = CODE.renderList;
    CODE.newCode();
    CODE.loadRuntimes();
    CODE.loadList();
};
CODE.gutter = function () { var n = ($('cw-code').value.match(/\n/g) || []).length + 1, s = ''; for (var i = 1; i <= n; i++) s += i + '\n'; $('cw-gutter').textContent = s; };
CODE.fillInputs = function () {
    var sel = $('cw-input'); if (!sel) return; var v = sel.value;
    sel.innerHTML = '<option value="">No input data</option>' + (AG.results || []).filter(function (r) { return !r.report && !r.doc; }).map(function (r) { return '<option value="' + esc(r.id) + '">input.csv ← ' + esc(r.title) + (r.rows != null ? ' (' + r.rows + ')' : '') + '</option>'; }).join('');
    sel.value = v;
};

// ── runtimes ──
CODE.loadRuntimes = function () {
    return CODE.cmd({ action: 'codeRuntimes' }).then(function (d) {
        CODE.runtimes = d.runtimes || []; CODE.admin = !!d.admin;
        $('cw-rt').innerHTML = (CODE.admin ? '' : '<div class="callout warn" style="margin:0 0 6px"><div class="co-t">Only AI admins can run code</div>You can still read and save code.</div>') +
            CODE.runtimes.map(function (r) {
                var L = CODE.LANGS[r.lang] || { label: r.lang, icon: 'fa-solid fa-code' }, ins = r.install || {};
                var state = r.installed ? '<span class="tag b-ok">ready</span>' : ins.State === 'running' ? '<span class="tag b-warn"><i class="fa-solid fa-circle-notch fa-spin"></i> installing</span>'
                    : '<button class="btn sm" ' + (CODE.admin ? '' : 'disabled ') + 'onclick="CODE.install(\'' + r.lang + '\')" title="' + esc(r.download) + '"><i class="fa-solid fa-download"></i> Install</button>';
                return '<div class="cw-rtrow"><i class="' + L.icon + '"></i> <span class="grow">' + esc(L.label) + '</span>' + state + '</div>' +
                    (ins.State === 'running' || ins.State === 'error' ? '<div class="sm muted cw-rtlog">' + esc(ins.Error || String(ins.Log || '').trim().split('\n').pop()) + '</div>' : '');
            }).join('');
        if (CODE.runtimes.some(function (r) { return r.install && r.install.State === 'running'; })) { clearTimeout(CODE._rt); CODE._rt = setTimeout(CODE.loadRuntimes, 3000); }
    }).catch(function (e) { $('cw-rt').innerHTML = '<p class="sm" style="color:#b91c1c">' + esc(e) + '</p>'; });
};
CODE.install = function (lang) {
    if (!confirm('Download and install ' + (CODE.LANGS[lang] || {}).label + ' for your Windows user? (' + ((CODE.runtimes.filter(function (r) { return r.lang === lang; })[0] || {}).download || '') + ')')) return;
    CODE.cmd({ action: 'codeInstall', lang: lang }).then(function (d) { if (d.ok === false) throw d.error; setTimeout(CODE.loadRuntimes, 800); }).catch(function (e) { toast(String(e), 'err'); });
};

// ── run ──
CODE.run = function () {
    var lang = $('cw-lang').value, code = $('cw-code').value;
    if (!code.trim()) { toast('Write or paste some code first', 'err'); return; }
    if (!CODE.admin) { toast('Only AI admins can run code', 'err'); return; }
    var rt = CODE.runtimes.filter(function (r) { return r.lang === lang; })[0];
    var install = rt && !rt.installed;
    if (install && !confirm((CODE.LANGS[lang] || {}).label + ' is not installed on this PC. Download it now (' + rt.download + ') and then run?')) return;
    var btn = $('cw-run'); btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Running…';
    $('cw-obody').innerHTML = '<p class="muted sm"><i class="fa-solid fa-circle-notch fa-spin"></i> ' + (install ? 'Installing ' + esc(lang) + ', then running…' : lang === 'csharp' ? 'Building and running (the first C# run takes a little longer)…' : 'Running…') + '</p>';
    var inputId = $('cw-input').value;
    var body = { action: 'codeRun', language: lang, code: code, timeout_s: +$('cw-timeout').value || 60, install: install,
        packages: $('cw-pkgs').value.split(',').map(function (x) { return x.trim(); }).filter(Boolean) };
    (inputId ? AG.fetchResult(inputId).then(function (d) { body.grid = { columns: d.columns.map(function (c) { return c.name; }), rows: d.rows }; }) : Promise.resolve())
        .then(function () { return CODE.cmd(body); })
        .then(function (d) {
            CODE.showOutput(d);
            if (CODE.cur && CODE.cur.id) dbWrite('UPDATE wms_ai_code_snippets SET run_count = NVL(run_count, 0) + 1, last_run = SYSDATE WHERE id = ' + (+CODE.cur.id)).catch(function () { });
            if (install) CODE.loadRuntimes();
        }).catch(function (e) { $('cw-obody').innerHTML = '<p class="sm" style="color:#b91c1c">' + esc(e) + '</p>'; })
        .then(function () { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-play"></i> Run'; });
};
CODE.showOutput = function (d) {
    var r = d.run || {}, tabs = [];
    if (!d.run) { $('cw-otabs').innerHTML = ''; $('cw-obody').innerHTML = '<div class="callout bad"><div class="co-t">Not run</div>' + esc(d.content || d.error || 'Failed') + '</div>'; return; }
    var head = '<div class="cw-status ' + (d.ok ? 'ok' : 'bad') + '">' + (d.ok ? '<i class="fa-solid fa-circle-check"></i> Finished' : '<i class="fa-solid fa-circle-xmark"></i> ' + esc(r.Error || 'Exit code ' + r.ExitCode)) +
        ' · ' + (r.Ms / 1000).toFixed(1) + ' s</div>';
    tabs.push(['out', 'Output', '<pre class="cw-pre">' + esc(r.Stdout || '(no output)') + '</pre>']);
    if (r.Stderr) tabs.push(['err', 'Errors', '<pre class="cw-pre err">' + esc(r.Stderr) + '</pre>']);
    if (r.Columns) tabs.push(['tbl', 'Table (' + r.Rows.length + ')', '<div class="res-acts"><button class="btn sm" onclick="CODE.toResults()"><i class="fa-solid fa-table"></i> Open in the results panel</button></div>' +
        '<div class="grid-wrap" style="max-height:300px"><table class="t"><thead><tr>' + r.Columns.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        r.Rows.slice(0, 300).map(function (row) { return '<tr>' + row.map(function (v) { return '<td>' + AGF.cell(v) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>']);
    if (r.image) tabs.push(['img', 'Chart', '<img src="' + r.image + '" style="max-width:100%;border-radius:8px">']);
    if (r.Files && r.Files.length) tabs.push(['files', 'Files (' + r.Files.length + ')', '<p class="sm muted">' + esc(r.Folder) + '</p><ul>' + r.Files.map(function (f) { return '<li>' + esc(f.name) + ' <span class="muted">' + (f.bytes / 1024).toFixed(1) + ' KB</span></li>'; }).join('') + '</ul>']);
    CODE.lastRun = r;
    var pick = r.image ? 'img' : r.Columns ? 'tbl' : !d.ok && r.Stderr ? 'err' : 'out';
    var draw = function (k) {
        $('cw-otabs').innerHTML = head + tabs.map(function (t) { return '<button class="' + (t[0] === k ? 'on' : '') + '" data-k="' + t[0] + '">' + t[1] + '</button>'; }).join('');
        $('cw-otabs').querySelectorAll('button').forEach(function (b) { b.onclick = function () { draw(b.dataset.k); }; });
        $('cw-obody').innerHTML = tabs.filter(function (t) { return t[0] === k; })[0][2];
    };
    draw(pick);
};
CODE.toResults = function () {
    var r = CODE.lastRun; if (!r || !r.Columns) return;
    AG.pageResult(($('cw-name').value || 'Code') + ' · output', r.Columns, r.Rows);
    CODE.showTab('chat'); AG.toggleResults && AG.toggleResults(true, true);
};
CODE.askAi = function () {
    var code = $('cw-code').value; if (!code.trim()) return;
    CODE.showTab('chat');
    $('input').value = 'Look at this ' + (CODE.LANGS[$('cw-lang').value] || {}).label + ' code' + (CODE.lastRun && !CODE.lastRun.ok && CODE.lastRun.Stderr ? ' and its error' : '') + ' and help me with it:\n```' + $('cw-lang').value + '\n' + code + '\n```' +
        (CODE.lastRun && CODE.lastRun.Stderr ? '\nError:\n```\n' + CODE.lastRun.Stderr.slice(-1500) + '\n```' : '');
    $('input').focus();
};

// ── saved code (APEX) ──
CODE.ensureTable = function () {
    if (CODE._table) return Promise.resolve();
    return rows("SELECT COUNT(*) AS N FROM user_tables WHERE table_name = 'WMS_AI_CODE_SNIPPETS'").then(function (r) {
        if (+((r[0] || {}).N) > 0) { CODE._table = true; return; }
        return dbWrite('CREATE TABLE wms_ai_code_snippets (id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name VARCHAR2(200) NOT NULL, language VARCHAR2(20) NOT NULL, ' +
            'description VARCHAR2(1000), code CLOB, packages VARCHAR2(1000), created_by VARCHAR2(100), created_date DATE DEFAULT SYSDATE, changed_by VARCHAR2(100), ' +
            'changed_date DATE, last_run DATE, run_count NUMBER DEFAULT 0, CONSTRAINT wms_ai_code_snippets_uk UNIQUE (name))').then(function () { CODE._table = true; });
    });
};
CODE.loadList = function () {
    return CODE.ensureTable().then(function () {
        return rows("SELECT id, name, language, description, packages, created_by, NVL(changed_by, created_by) AS who, TO_CHAR(NVL(changed_date, created_date), 'YYYY-MM-DD HH24:MI') AS at, " +
            "run_count, TO_CHAR(last_run, 'YYYY-MM-DD HH24:MI') AS last_run, LENGTH(code) AS code_len FROM wms_ai_code_snippets ORDER BY NVL(changed_date, created_date) DESC", 500);
    }).then(function (r) { CODE.list = r; CODE.renderList(); }).catch(function (e) { $('cw-list').innerHTML = '<p class="sm" style="color:#b91c1c">' + esc(e) + '</p>'; });
};
CODE.renderList = function () {
    var f = ($('cw-filter').value || '').toLowerCase();
    var list = CODE.list.filter(function (s) { return !f || (s.NAME + ' ' + (s.DESCRIPTION || '') + ' ' + s.LANGUAGE).toLowerCase().indexOf(f) >= 0; });
    $('cw-list').innerHTML = list.length ? list.map(function (s) {
        var L = CODE.LANGS[s.LANGUAGE] || { icon: 'fa-solid fa-code', label: s.LANGUAGE };
        return '<div class="cw-item' + (CODE.cur && +CODE.cur.id === +s.ID ? ' on' : '') + '" data-id="' + s.ID + '"><i class="' + L.icon + '"></i><div class="grow"><b>' + esc(s.NAME) + '</b>' +
            (s.DESCRIPTION ? '<div class="sm muted">' + esc(s.DESCRIPTION) + '</div>' : '') + '<div class="sm muted">' + esc(L.label) + ' · ' + esc(s.WHO || '') + ' · ' + esc(s.AT || '') + (+s.RUN_COUNT ? ' · ran ' + s.RUN_COUNT + '×' : '') + '</div></div>' +
            '<button class="icon" title="Delete" data-del="' + s.ID + '"><i class="fa-regular fa-trash-can"></i></button></div>';
    }).join('') : '<p class="muted sm">' + (CODE.list.length ? 'Nothing matches.' : 'No saved code yet — write something and press Save.') + '</p>';
    $('cw-list').querySelectorAll('.cw-item').forEach(function (el) { el.onclick = function (e) { if (e.target.closest('[data-del]')) return; CODE.open(+el.dataset.id); }; });
    $('cw-list').querySelectorAll('[data-del]').forEach(function (b) { b.onclick = function () { CODE.remove(+b.dataset.del); }; });
};
/** Reads one saved snippet with its full code (CLOB read in 4,000-character pieces). */
CODE.get = function (idOrName) {
    var where = typeof idOrName === 'number' ? 'id = ' + idOrName : 'UPPER(name) = UPPER(' + lit(idOrName) + ')';
    return CODE.ensureTable().then(function () { return rows('SELECT id, name, language, description, packages, LENGTH(code) AS len FROM wms_ai_code_snippets WHERE ' + where, 1); }).then(function (r) {
        var s = r[0]; if (!s) throw 'No saved code ' + idOrName;
        var n = Math.min(40, Math.max(1, Math.ceil((+s.LEN || 0) / 4000))), cols = [];
        for (var i = 0; i < n; i++) cols.push('TO_CHAR(SUBSTR(code, ' + (i * 4000 + 1) + ', 4000)) AS c' + i);
        return rows('SELECT ' + cols.join(', ') + ' FROM wms_ai_code_snippets WHERE id = ' + (+s.ID), 1).then(function (p) {
            var code = ''; for (var j = 0; j < n; j++) code += (p[0] || {})['C' + j] || '';
            return { id: +s.ID, name: s.NAME, language: s.LANGUAGE, description: s.DESCRIPTION || '', packages: s.PACKAGES || '', code: code };
        });
    });
};
CODE.open = function (id) {
    CODE.get(id).then(function (s) {
        CODE.cur = s;
        $('cw-name').value = s.name; $('cw-lang').value = s.language; $('cw-desc').value = s.description; $('cw-pkgs').value = s.packages;
        $('cw-code').value = s.code; CODE.gutter(); CODE.renderList(); CODE.fillInputs();
        $('cw-otabs').innerHTML = ''; $('cw-obody').innerHTML = '<p class="muted sm">Press Run (Ctrl+Enter) to run it.</p>';
    }).catch(function (e) { toast(String(e), 'err'); });
};
CODE.newCode = function () {
    CODE.cur = null;
    $('cw-name').value = ''; $('cw-desc').value = ''; $('cw-pkgs').value = '';
    $('cw-code').value = CODE.LANGS[$('cw-lang').value].sample; CODE.gutter(); CODE.fillInputs();
    if ($('cw-list')) CODE.renderList();
};
CODE.save = function () {
    var name = $('cw-name').value.trim(), code = $('cw-code').value, lang = $('cw-lang').value;
    if (!name) { $('cw-name').focus(); toast('Give the code a name to save it', 'err'); return; }
    if (code.length > 150000) { toast('Code is too long to save (max 150,000 characters)', 'err'); return; }
    var u = appUser() || 'UNKNOWN';
    CODE.ensureTable().then(function () {
        return dbWrite('MERGE INTO wms_ai_code_snippets t USING (SELECT ' + lit(name.slice(0, 200)) + ' AS name FROM dual) s ON (t.name = s.name) ' +
            'WHEN MATCHED THEN UPDATE SET language = ' + lit(lang) + ', description = ' + vlit($('cw-desc').value, 1000) + ', packages = ' + vlit($('cw-pkgs').value, 1000) +
            ', code = ' + clob(code) + ', changed_by = ' + lit(u) + ', changed_date = SYSDATE ' +
            'WHEN NOT MATCHED THEN INSERT (name, language, description, packages, code, created_by) VALUES (s.name, ' + lit(lang) + ', ' + vlit($('cw-desc').value, 1000) + ', ' +
            vlit($('cw-pkgs').value, 1000) + ', ' + clob(code) + ', ' + lit(u) + ')');
    }).then(function () { toast('Saved “' + name + '”', 'ok'); return CODE.loadList(); }).then(function () {
        var s = CODE.list.filter(function (x) { return x.NAME === name; })[0]; if (s) { CODE.cur = { id: +s.ID, name: name }; CODE.renderList(); }
    }).catch(function (e) { toast('Save failed: ' + e, 'err'); });
};
CODE.remove = function (id) {
    var s = CODE.list.filter(function (x) { return +x.ID === id; })[0];
    if (!s || !confirm('Delete the saved code “' + s.NAME + '”?')) return;
    dbWrite('DELETE FROM wms_ai_code_snippets WHERE id = ' + (+id)).then(function () { if (CODE.cur && CODE.cur.id === id) CODE.newCode(); return CODE.loadList(); }).catch(function (e) { toast(String(e), 'err'); });
};

// ── agent tools: list / read saved code; run_code's confirm card shows the full code ──
AG.tool('saved_code', function (inp) {
    if ((inp.op || 'list') === 'get') return CODE.get(inp.name || '').then(function (s) {
        return { ok: true, content: 'Saved code "' + s.name + '" (' + s.language + (s.packages ? ', packages ' + s.packages : '') + '): ' + s.description + '\n```' + s.language + '\n' + s.code + '\n```' };
    }, function (e) { return { ok: false, content: String(e) }; });
    return CODE.ensureTable().then(function () { return rows("SELECT name, language, description, run_count FROM wms_ai_code_snippets ORDER BY name", 300); }).then(function (r) {
        return { ok: true, content: r.length ? r.map(function (s) { return '- ' + s.NAME + ' (' + s.LANGUAGE + ')' + (s.DESCRIPTION ? ': ' + s.DESCRIPTION : ''); }).join('\n') : 'No saved code yet.' };
    }, function (e) { return { ok: false, content: String(e) }; });
});
AG.preview.run_code = function (i) {
    var L = CODE.LANGS[CODE.normLang(i.language)] || { label: i.language };
    return '<div class="why"><i class="fa-solid fa-code"></i> Run <b>' + esc(L.label) + '</b> code on this PC' + (i.purpose ? ' — ' + esc(i.purpose) : '') + (i.result_id ? ' (input.csv ← ' + esc(i.result_id) + ')' : '') + ':</div>' +
        '<pre class="cw-pre" style="max-height:320px">' + esc(i.code || '') + '</pre>' +
        '<div class="muted sm">Runs as your Windows user in its own process' + (i.packages && i.packages.length ? ' · installs ' + esc(i.packages.join(', ')) : '') + ' · time limit ' + (i.timeout_s || 60) + ' s' +
        (i.install ? ' · downloads ' + esc(L.label) + ' first if it is missing' : '') + '. Read it before you approve.</div>';
};
CODE.normLang = function (l) { l = String(l || '').toLowerCase(); return { py: 'python', 'c#': 'csharp', cs: 'csharp', js: 'javascript', node: 'javascript', ps1: 'powershell', pwsh: 'powershell' }[l] || l; };

// tab state + keep the input picker fresh
(function () {
    var go = function () {
        document.querySelectorAll('.ag-tabs button').forEach(function (b) { b.onclick = function () { CODE.showTab(b.dataset.tab); }; });
        var t = 'chat'; try { t = localStorage.getItem('aiagent.tab') || 'chat'; } catch (e) { /* private mode */ }
        if (t === 'code') CODE.showTab('code');
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
    var origAdd = AG.addResult;
    AG.addResult = function () { var r = origAdd.apply(this, arguments); if (CODE.started) CODE.fillInputs(); return r; };
})();
