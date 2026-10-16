/* AI Agent — the Code tab: write / paste code, run it on this PC, save it to run again later.
   Languages: Python, C#, JavaScript, PowerShell (classes/CodeRunner.cs runs each in its own process; missing runtimes
   are downloaded with one click). Only AI admins run code; every run is audited. Saved code lives in APEX
   (WMS_AI_CODE_SNIPPETS, apex_sql/83_ai_code_snippets.sql, created here on first use) so it can be opened and run
   again from any PC — and the agent can list it (tool saved_code) and run it (tool run_code, always a confirm card).
   Data in: pick a result → input.csv. Data out: print → Output, output.csv → a table (send it to the results panel),
   *.png → shown (e.g. a matplotlib chart).
   Data sources (the Data button, up to 3, saved with the code): read-only Fusion SQL (BI Publisher runner, any pod) or APEX
   SQL run by the PAGE right before each run — HTML gets window.DATA.<name> = { columns, rows } (and INPUT = the first when
   no result is picked) in a preview with no network; the other languages get <name>.csv in their work folder. */

var CODE = window.CODE = { cur: null, list: [], runtimes: [], admin: false, data: [], dataCache: {} };

CODE.LANGS = {
    python: { label: 'Python', ext: 'py', icon: 'fa-brands fa-python', sample: '# input.csv = the result you picked (if any); write output.csv for a table, *.png for charts\nimport pandas as pd, os\n\nif os.path.exists("input.csv"):\n    df = pd.read_csv("input.csv")\n    print(df.describe(include="all"))\n    df.head(20).to_csv("output.csv", index=False)\nelse:\n    print("Hello from Python")\n' },
    csharp: { label: 'C#', ext: 'cs', icon: 'fa-solid fa-hashtag', sample: '// top-level statements (.NET 8). input.csv / output.csv work the same way.\nusing System.IO;\n\nif (File.Exists("input.csv"))\n{\n    var lines = File.ReadAllLines("input.csv");\n    Console.WriteLine($"{lines.Length - 1} rows, columns: {lines[0]}");\n}\nelse Console.WriteLine("Hello from C#");\n' },
    javascript: { label: 'JavaScript', ext: 'js', icon: 'fa-brands fa-node-js', sample: '// Node.js. input.csv / output.csv work the same way.\nconst fs = require("fs");\nif (fs.existsSync("input.csv")) {\n  const rows = fs.readFileSync("input.csv", "utf8").trim().split(/\\r?\\n/);\n  console.log(rows.length - 1, "rows");\n} else console.log("Hello from Node.js");\n' },
    powershell: { label: 'PowerShell', ext: 'ps1', icon: 'fa-solid fa-terminal', sample: '# Windows PowerShell. input.csv / output.csv work the same way.\nif (Test-Path input.csv) { $d = Import-Csv input.csv; "{0} rows" -f $d.Count }\nelse { "Hello from PowerShell on $env:COMPUTERNAME" }\n' },
    html: { label: 'HTML / CSS / JS', ext: 'html', icon: 'fa-brands fa-html5', page: true, sample: '<!-- HTML + CSS + JavaScript: shown live below in a sealed frame (no access to the app, your files or Windows).\n     The picked result is available as window.INPUT = { columns, rows }. console.log goes to the Console tab. -->\n<style>\n  body { font-family: Segoe UI, sans-serif; padding: 24px; }\n  .card { padding: 16px 20px; border-radius: 12px; background: #eef2ff; display: inline-block; }\n</style>\n<div class="card"><h2>Hello from HTML</h2><button onclick="go()">Click me</button> <span id="out"></span></div>\n<script>\n  function go() { document.getElementById("out").textContent = new Date().toLocaleTimeString(); console.log("clicked"); }\n  if (window.INPUT) console.log("input:", INPUT.rows.length, "rows");\n</script>\n' }
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
        '<label class="sm muted">Limit <input type="number" id="cw-timeout" value="60" min="5" max="600" style="width:58px"> s</label>' +
        '<button class="btn sm" id="cw-dbtn" onclick="CODE.toggleData()" title="Fusion / APEX queries that run before the code and hand it their rows"><i class="fa-solid fa-database"></i> Data <span id="cw-dn"></span></button></div>' +
        '<div class="cw-data" id="cw-data" hidden></div>' +
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
    $('cw-lang').addEventListener('change', function () { if (!$('cw-data').hidden) CODE.renderData(); });
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
            }).join('') +
            '<div class="cw-rtrow"><i class="fa-brands fa-html5"></i> <span class="grow">HTML / CSS / JS</span><span class="tag b-ok" title="Runs in the page in a sealed frame — anyone can preview">built in</span></div>';
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
    if (lang === 'html') { CODE.runHtml(code); return; }
    if (!CODE.admin) { toast('Only AI admins can run code', 'err'); return; }
    var rt = CODE.runtimes.filter(function (r) { return r.lang === lang; })[0];
    var install = rt && !rt.installed;
    if (install && !confirm((CODE.LANGS[lang] || {}).label + ' is not installed on this PC. Download it now (' + rt.download + ') and then run?')) return;
    var btn = $('cw-run'); btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Running…';
    $('cw-obody').innerHTML = '<p class="muted sm"><i class="fa-solid fa-circle-notch fa-spin"></i> ' + (install ? 'Installing ' + esc(lang) + ', then running…' : lang === 'csharp' ? 'Building and running (the first C# run takes a little longer)…' : 'Running…') + '</p>';
    var inputId = $('cw-input').value;
    if (CODE.data.length) $('cw-obody').innerHTML = '<p class="muted sm"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading data (' + CODE.data.map(function (d) { return esc(d.name); }).join(', ') + '), then ' + (install ? 'installing and running' : 'running') + '…</p>';
    var body = { action: 'codeRun', language: lang, code: code, timeout_s: +$('cw-timeout').value || 60, install: install,
        packages: $('cw-pkgs').value.split(',').map(function (x) { return x.trim(); }).filter(Boolean) };
    (inputId ? AG.fetchResult(inputId).then(function (d) { body.grid = { columns: d.columns.map(function (c) { return c.name; }), rows: d.rows }; }) : Promise.resolve())
        .then(function () { return CODE.loadData(); })
        .then(function (data) {
            if (data.length) body.data = data.map(function (x) { return { name: x.name, columns: x.columns, rows: x.rows }; });
            return CODE.cmd(body);
        })
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
        ' · ' + (r.Ms / 1000).toFixed(1) + ' s</div>' + CODE.dataNote();
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
// ── HTML: runs in the page, in a sandboxed frame (scripts yes; same origin NO → no app IPC, no cookies, no parent DOM) ──
CODE.htmlShim = function (input, data) {
    // in-memory storage (a sealed frame has none), console + errors posted to the Code tab, the picked result as INPUT
    return '<script>(function(){var mem=function(){var d={};return{getItem:function(k){return k in d?d[k]:null},setItem:function(k,v){d[k]=String(v)},removeItem:function(k){delete d[k]},clear:function(){d={}},key:function(i){return Object.keys(d)[i]||null},get length(){return Object.keys(d).length}}};' +
        '["localStorage","sessionStorage"].forEach(function(n){try{window[n].length}catch(e){try{Object.defineProperty(window,n,{value:mem(),configurable:true})}catch(x){}}});' +
        'var send=function(k,a){try{parent.postMessage({cwHtml:1,k:k,m:[].map.call(a,function(x){try{return typeof x==="object"?JSON.stringify(x,null,1):String(x)}catch(e){return String(x)}}).join(" ")},"*")}catch(e){}};' +
        '["log","info","warn","error","table"].forEach(function(k){var o=console[k];console[k]=function(){send(k,arguments);o&&o.apply(console,arguments)}});' +
        'window.addEventListener("error",function(e){send("error",[e.message+(e.lineno?" (line "+e.lineno+")":"")])});' +
        'window.addEventListener("unhandledrejection",function(e){send("error",["Unhandled promise: "+(e.reason&&e.reason.message||e.reason)])});' +
        'window.INPUT=' + JSON.stringify(input || null).replace(/</g, '\\u003c') + ';window.DATA=' + JSON.stringify(data || {}).replace(/</g, '\\u003c') + ';})();<\/script>';
};
// With data loaded the preview gets NO network (CSP first in the document, before any of the user's markup: no fetch / XHR /
// WebSocket, no images or forms to other sites — scripts, styles and fonts only from the CDNs the app itself uses) and no popups.
CODE.HTML_CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; " +
    "style-src 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; font-src data: https://fonts.gstatic.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; " +
    "img-src data: blob:; media-src data: blob:; connect-src 'none'; frame-src 'none'; worker-src blob:; form-action 'none'; base-uri 'none'";
CODE.htmlDoc = function (code, input, data) {
    var sealed = data && Object.keys(data).length > 0;
    // our head goes first; the parser folds the user's own <html> / <head> into it, so the CSP is in force before their first tag
    return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
        (sealed ? '<meta http-equiv="Content-Security-Policy" content="' + CODE.HTML_CSP + '">' : '') + CODE.htmlShim(input, data) + '</head>' +
        String(code).replace(/^\s*<!doctype[^>]*>/i, '');
};
// "cw-sealed…" frames: the host (AttachSealedFrameGuard) cancels any navigation of them away from the preview
CODE.frameName = function () { return (CODE.htmlSealed ? 'cw-sealed-' : 'cw-preview-') + Date.now().toString(36); };
CODE.htmlSandbox = function () { return 'allow-scripts allow-forms allow-modals' + (CODE.htmlSealed ? '' : ' allow-popups'); };
/** A sealed preview must stay on its own document: a second load means it navigated away (e.g. location = url) → close it. */
CODE.watchFrame = function (f) {
    var loads = 0;
    f.addEventListener('load', function () {
        if (++loads < 2 || !CODE.htmlSealed) return;
        f.removeAttribute('srcdoc'); f.src = 'about:blank';
        CODE.htmlLog.push({ k: 'error', m: 'The page tried to leave the preview while it held data — it was closed. Use links only without Data sources.' });
        CODE.drawHtml('log');
    });
};
CODE.runHtml = function (code) {
    var inputId = $('cw-input').value, t0 = Date.now(), input = null;
    if (CODE.data.length) $('cw-obody').innerHTML = '<p class="muted sm"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading data (' + CODE.data.map(function (d) { return esc(d.name); }).join(', ') + ')…</p>';
    (inputId ? AG.fetchResult(inputId).then(function (d) { input = { columns: d.columns.map(function (c) { return c.name; }), rows: d.rows }; }) : Promise.resolve()).then(function () { return CODE.loadData(); }).then(function (list) {
        var data = {}; list.forEach(function (x) { data[x.name] = { columns: x.columns, rows: x.rows }; });
        if (!input && list.length) input = data[list[0].name];
        CODE.htmlSealed = list.length > 0;
        CODE.htmlLog = []; CODE.htmlSrc = CODE.htmlDoc(code, input, data);
        CODE.lastRun = { ok: true, Stdout: '', Stderr: '' };
        CODE.drawHtml('view');
        if (CODE.cur && CODE.cur.id) dbWrite('UPDATE wms_ai_code_snippets SET run_count = NVL(run_count, 0) + 1, last_run = SYSDATE WHERE id = ' + (+CODE.cur.id)).catch(function () { });
        CODE._htmlT0 = t0;
    }).catch(function (e) { $('cw-obody').innerHTML = '<p class="sm" style="color:#b91c1c">' + esc(e) + '</p>'; });
};
CODE.drawHtml = function (k) {
    var errs = CODE.htmlLog.filter(function (l) { return l.k === 'error'; }).length;
    $('cw-otabs').innerHTML = '<div class="cw-status ' + (errs ? 'bad' : 'ok') + '"><i class="fa-brands fa-html5"></i> Live preview' + (errs ? ' · ' + errs + ' error' + (errs > 1 ? 's' : '') : '') + '</div>' + CODE.dataNote() +
        [['view', 'Preview'], ['log', 'Console (' + CODE.htmlLog.length + ')']].concat(CODE.lastData && CODE.lastData.length ? [['data', 'Data (' + CODE.lastData.length + ')']] : []).map(function (t) { return '<button class="' + (t[0] === k ? 'on' : '') + '" data-k="' + t[0] + '">' + t[1] + '</button>'; }).join('') +
        '<span class="grow"></span><button data-a="full" title="Full screen"><i class="fa-solid fa-expand"></i> Full screen</button><button data-a="save" title="Save as an .html file"><i class="fa-solid fa-download"></i> Save .html</button>';
    $('cw-otabs').querySelectorAll('button').forEach(function (b) {
        b.onclick = function () { if (b.dataset.a === 'full') CODE.htmlFull(); else if (b.dataset.a === 'save') CODE.htmlSave(); else CODE.drawHtml(b.dataset.k); };
    });
    if (k === 'data') { CODE._htmlTab = 'data'; $('cw-obody').innerHTML = CODE.dataPreview(); return; }
    if (k === 'log') {
        CODE._htmlTab = 'log';
        $('cw-obody').innerHTML = CODE.htmlLog.length ? '<pre class="cw-pre">' + CODE.htmlLog.map(function (l) { return '<span class="' + (l.k === 'error' ? 'cw-lerr' : l.k === 'warn' ? 'cw-lwarn' : '') + '">' + esc(l.m) + '</span>'; }).join('\n') + '</pre>' : '<p class="muted sm">Nothing logged yet. console.log(…) in your script shows up here.</p>';
        return;
    }
    if (CODE._htmlTab === 'view' && $('cw-frame') && $('cw-frame')._src === CODE.htmlSrc) return;   // keep the running page
    CODE._htmlTab = 'view';
    $('cw-obody').innerHTML = '<iframe id="cw-frame" name="' + CODE.frameName() + '" class="cw-frame" sandbox="' + CODE.htmlSandbox() + '" referrerpolicy="no-referrer"></iframe>';
    var f = $('cw-frame'); f._src = CODE.htmlSrc; CODE.watchFrame(f); f.srcdoc = CODE.htmlSrc;
};
window.addEventListener('message', function (e) {
    var d = e.data; if (!d || d.cwHtml !== 1) return;
    var ok = [$('cw-frame'), $('cw-fframe')].some(function (f) { return f && f.contentWindow === e.source; }); if (!ok) return;
    CODE.htmlLog.push({ k: d.k, m: String(d.m || '').slice(0, 4000) }); if (CODE.htmlLog.length > 500) CODE.htmlLog.shift();
    var st = document.querySelector('#cw-otabs .cw-status'), btn = document.querySelector('#cw-otabs button[data-k="log"]');
    if (btn) btn.textContent = 'Console (' + CODE.htmlLog.length + ')';
    var errs = CODE.htmlLog.filter(function (l) { return l.k === 'error'; }).length;
    if (st && errs) { st.className = 'cw-status bad'; st.innerHTML = '<i class="fa-brands fa-html5"></i> Live preview · ' + errs + ' error' + (errs > 1 ? 's' : ''); }
    if (CODE._htmlTab === 'log') CODE.drawHtml('log');
    if (d.k === 'error') CODE.lastRun = { ok: false, Stdout: '', Stderr: CODE.htmlLog.filter(function (l) { return l.k === 'error'; }).map(function (l) { return l.m; }).join('\n') };
});
CODE.htmlFull = function () {
    if (!CODE.htmlSrc) return;
    var ov = document.createElement('div'); ov.className = 'cw-full';
    ov.innerHTML = '<div class="cw-full-bar"><b class="grow"><i class="fa-brands fa-html5"></i> ' + esc($('cw-name').value || 'Preview') + '</b><button class="btn sm" data-a="re"><i class="fa-solid fa-rotate-right"></i> Reload</button> <button class="btn sm" data-a="x"><i class="fa-solid fa-xmark"></i> Close (Esc)</button></div>' +
        '<iframe id="cw-fframe" name="' + CODE.frameName() + '" class="cw-frame" sandbox="' + CODE.htmlSandbox() + '" referrerpolicy="no-referrer"></iframe>';
    document.body.appendChild(ov);
    var f = ov.querySelector('iframe'); CODE.watchFrame(f); f.srcdoc = CODE.htmlSrc;
    var close = function () { ov.remove(); document.removeEventListener('keydown', esck); };
    var esck = function (e) { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', esck);
    ov.querySelector('[data-a="x"]').onclick = close;
    ov.querySelector('[data-a="re"]').onclick = function () { var g = f.cloneNode(); f.replaceWith(g); f = g; CODE.watchFrame(f); f.srcdoc = CODE.htmlSrc; };
};
CODE.htmlSave = function () {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([$('cw-code').value], { type: 'text/html' }));
    a.download = (($('cw-name').value || 'page').replace(/[^\w\- ]+/g, '').trim() || 'page') + '.html';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
};
// ── Data sources ──
CODE.DS_TEMPLATES = {
    customers: { label: 'Fusion customers', src: 'FUSION', sql: "SELECT hca.account_number, hp.party_name, hca.cust_account_id\nFROM   hz_cust_accounts hca\nJOIN   hz_parties hp ON hp.party_id = hca.party_id\nWHERE  hca.status = 'A'\nORDER  BY hp.party_name" },
    items: { label: 'Fusion items', src: 'FUSION', sql: "SELECT esi.item_number, esi.description, esi.primary_uom_code\nFROM   egp_system_items_vl esi\nWHERE  esi.organization_id = (SELECT MIN(master_organization_id) FROM inv_org_parameters)\nAND    esi.inventory_item_status_code = 'Active'\nORDER  BY esi.item_number" },
    warehouses: { label: 'Fusion warehouses', src: 'FUSION', sql: "SELECT organization_code, organization_id\nFROM   inv_org_parameters\nORDER  BY organization_code" },
    trips: { label: 'WMS trips (APEX)', src: 'APEX', sql: "SELECT *\nFROM   wms_trip_config\nWHERE  ROWNUM <= 500" }
};
CODE.SRC_LABEL = { FUSION: 'Fusion · this page\'s pod', 'FUSION:PROD': 'Fusion PROD', 'FUSION:TEST': 'Fusion TEST', APEX: 'APEX (WMS database)' };
CODE.toggleData = function (show) {
    var el = $('cw-data'); el.hidden = show == null ? !el.hidden : !show;
    if (!el.hidden) CODE.renderData();
};
CODE.dataCount = function () { $('cw-dn').textContent = CODE.data.length ? '(' + CODE.data.length + ')' : ''; $('cw-dbtn').classList.toggle('primary', CODE.data.length > 0); };
CODE.useHint = function (name) {
    var n = name || 'customers', lang = $('cw-lang').value;
    return { html: 'DATA.' + n + '.rows · DATA.' + n + '.columns (the first source is also INPUT)', python: 'pd.read_csv("' + n + '.csv")', csharp: 'File.ReadAllLines("' + n + '.csv")',
        javascript: 'fs.readFileSync("' + n + '.csv", "utf8")', powershell: 'Import-Csv ' + n + '.csv' }[lang] || n + '.csv';
};
CODE.renderData = function () {
    var el = $('cw-data'); CODE.dataCount();
    el.innerHTML = '<div class="cw-dh"><b><i class="fa-solid fa-database"></i> Data for this code</b><span class="sm muted grow">Read-only queries run right before each run' +
        ($('cw-lang').value === 'html' ? ' — the preview then has no network, so the data stays in the app' : '') + '.</span>' +
        '<button class="btn sm" onclick="CODE.dataCache = {}; toast(\'Data will be read again on the next run\', \'ok\')" title="Results are kept 5 minutes while you edit"><i class="fa-solid fa-rotate"></i> Fresh data next run</button></div>' +
        CODE.data.map(function (d, i) {
            return '<div class="cw-ds" data-i="' + i + '"><div class="cw-dsr">' +
                '<input type="text" class="cw-dsn" value="' + esc(d.name) + '" placeholder="name" title="Letters, digits and _ — used as DATA.name / name.csv">' +
                '<select class="cw-dss">' + Object.keys(CODE.SRC_LABEL).map(function (k) { return '<option value="' + k + '"' + (d.src === k ? ' selected' : '') + '>' + CODE.SRC_LABEL[k] + (k === 'FUSION' ? ' (' + AG.pod + ')' : '') + '</option>'; }).join('') + '</select>' +
                '<label class="sm muted">max <input type="number" class="cw-dsm" value="' + (d.max || 5000) + '" min="1" max="50000" style="width:74px"> rows</label>' +
                '<span class="grow sm muted cw-dsu">' + esc(CODE.useHint(d.name)) + '</span>' +
                '<button class="btn sm" data-a="test"><i class="fa-solid fa-play"></i> Test</button><button class="icon" data-a="del" title="Remove"><i class="fa-regular fa-trash-can"></i></button></div>' +
                '<textarea class="cw-dsq" rows="4" spellcheck="false" placeholder="SELECT …">' + esc(d.sql) + '</textarea><div class="cw-dst sm muted"></div></div>';
        }).join('') +
        (CODE.data.length < 3 ? '<div class="cw-dadd"><button class="btn sm" data-t=""><i class="fa-solid fa-plus"></i> Add query</button>' +
            Object.keys(CODE.DS_TEMPLATES).map(function (k) { return '<button class="btn sm ghost" data-t="' + k + '">＋ ' + esc(CODE.DS_TEMPLATES[k].label) + '</button>'; }).join('') + '</div>' : '<p class="sm muted">Up to 3 data sources.</p>');
    el.querySelectorAll('.cw-ds').forEach(function (box) {
        var i = +box.dataset.i, d = CODE.data[i];
        box.querySelector('.cw-dsn').oninput = function () { d.name = this.value.trim(); box.querySelector('.cw-dsu').textContent = CODE.useHint(d.name); };
        box.querySelector('.cw-dss').onchange = function () { d.src = this.value; };
        box.querySelector('.cw-dsm').oninput = function () { d.max = Math.min(50000, Math.max(1, +this.value || 5000)); };
        box.querySelector('.cw-dsq').oninput = function () { d.sql = this.value; };
        box.querySelector('[data-a="del"]').onclick = function () { CODE.data.splice(i, 1); CODE.renderData(); };
        box.querySelector('[data-a="test"]').onclick = function () {
            var out = box.querySelector('.cw-dst'); out.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Running…';
            CODE.fetchData(d, true).then(function (x) {
                out.innerHTML = '<span class="tag b-ok">' + x.rows.length.toLocaleString() + ' rows</span> ' + (x.rows.length >= (d.max || 5000) ? '<span class="tag b-warn">limit reached</span> ' : '') +
                    (x.ms / 1000).toFixed(1) + ' s · ' + x.columns.map(esc).join(', ');
            }).catch(function (e) { out.innerHTML = '<span style="color:#b91c1c">' + esc(e) + '</span>'; });
        };
    });
    el.querySelectorAll('[data-t]').forEach(function (b) {
        b.onclick = function () {
            var t = CODE.DS_TEMPLATES[b.dataset.t], base = b.dataset.t || 'data', name = base, n = 2;
            while (CODE.data.some(function (x) { return x.name === name; })) name = base + n++;
            CODE.data.push({ name: name, src: t ? t.src : 'FUSION', max: 5000, sql: t ? t.sql : '' });
            CODE.renderData();
            var boxes = el.querySelectorAll('.cw-dsq'); if (boxes.length) boxes[boxes.length - 1].focus();
        };
    });
};
CODE.checkData = function () {
    var seen = {};
    CODE.data.forEach(function (d) {
        if (!/^[A-Za-z_]\w{0,39}$/.test(d.name || '')) throw 'Data name "' + (d.name || '') + '": use letters, digits and _ (it becomes DATA.' + (d.name || 'name') + ' / ' + (d.name || 'name') + '.csv)';
        if (/^(input|output)$/i.test(d.name)) throw 'Data name "' + d.name + '" is reserved — pick another';
        if (seen[d.name.toLowerCase()]) throw 'Two data sources are called "' + d.name + '"';
        seen[d.name.toLowerCase()] = 1;
        if (!/^\s*(\/\*[\s\S]*?\*\/\s*|--[^\n]*\n\s*)*(SELECT|WITH)\b/i.test(d.sql || '')) throw 'Data "' + d.name + '": only a SELECT (or WITH … SELECT) query can be used';
    });
};
/** One source → { name, columns: [..], rows: [[..]], ms, src }. Fusion: the read-only BI Publisher runner; APEX: ai/executequery (read-only). */
CODE.fetchData = function (d, fresh) {
    var pod = d.src === 'FUSION' ? AG.pod : d.src === 'FUSION:TEST' ? 'TEST' : d.src === 'FUSION:PROD' ? 'PROD' : '';
    var max = Math.min(50000, Math.max(1, +d.max || 5000)), key = (d.src || '') + '|' + pod + '|' + max + '|' + d.sql, c = CODE.dataCache[key], t0 = Date.now();
    if (!fresh && c && Date.now() - c.at < 300000) return Promise.resolve(Object.assign({}, c.v, { name: d.name, cached: true }));
    var sql = String(d.sql || '').trim().replace(/;\s*$/, '');
    var p = String(d.src).indexOf('FUSION') === 0
        ? host('fusionSqlExecute', { sql: sql, rowLimit: max, instance: pod }, 600000).then(function (r) {
            if (!r || !r.success) throw (r && r.error) || 'Fusion query failed';
            var cols = (r.columns || []).map(function (x) { return String(x.name || x); });
            return { columns: cols, rows: (r.rows || []).map(function (row) { return Array.isArray(row) ? row : cols.map(function (k) { return row[k] == null ? null : row[k]; }); }) };
        })
        : apex('/executequery', { sql: sql, maxRows: max }).then(function (r) {
            var cols = (r.columns || []).map(function (x) { return String(x.name || x); });
            return { columns: cols, rows: (r.rows || []).map(function (row) { return Array.isArray(row) ? row : cols.map(function (k) { return row[k] != null ? row[k] : row[k.toUpperCase()] != null ? row[k.toUpperCase()] : null; }); }) };
        });
    return p.then(function (v) {
        v.ms = Date.now() - t0; v.src = d.src === 'FUSION' ? 'Fusion ' + pod : CODE.SRC_LABEL[d.src] || d.src;
        CODE.dataCache[key] = { at: Date.now(), v: v };
        return Object.assign({}, v, { name: d.name });
    }, function (e) { throw 'Data "' + d.name + '": ' + e; });
};
CODE.loadData = function () {
    CODE.lastData = [];
    if (!CODE.data.length) return Promise.resolve([]);
    try { CODE.checkData(); } catch (e) { return Promise.reject(e); }
    return Promise.all(CODE.data.map(function (d) { return CODE.fetchData(d); })).then(function (list) { CODE.lastData = list; return list; });
};
CODE.dataNote = function () {
    return (CODE.lastData || []).length ? '<span class="cw-dnote" title="Data sources">' + CODE.lastData.map(function (x) {
        return '<span class="tag"><i class="fa-solid fa-database"></i> ' + esc(x.name) + ' · ' + x.rows.length.toLocaleString() + (x.cached ? ' (kept)' : '') + '</span>';
    }).join(' ') + '</span>' : '';
};
CODE.dataPreview = function () {
    return CODE.lastData.map(function (x) {
        return '<h4 style="margin:6px 0">' + esc(x.name) + ' <span class="sm muted">' + esc(x.src) + ' · ' + x.rows.length.toLocaleString() + ' rows · ' + esc(CODE.useHint(x.name)) + '</span></h4>' +
            '<div class="grid-wrap" style="max-height:220px"><table class="t"><thead><tr>' + x.columns.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
            x.rows.slice(0, 50).map(function (r) { return '<tr>' + r.map(function (v) { return '<td>' + esc(v == null ? '' : v) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
    }).join('');
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
        if (+((r[0] || {}).N) > 0) {
            // data_json came later (Data sources): add it to tables made before
            return rows("SELECT COUNT(*) AS N FROM user_tab_columns WHERE table_name = 'WMS_AI_CODE_SNIPPETS' AND column_name = 'DATA_JSON'").then(function (c) {
                return +((c[0] || {}).N) > 0 ? null : dbWrite('ALTER TABLE wms_ai_code_snippets ADD (data_json CLOB)');
            }).then(function () { CODE._table = true; });
        }
        return dbWrite('CREATE TABLE wms_ai_code_snippets (id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name VARCHAR2(200) NOT NULL, language VARCHAR2(20) NOT NULL, ' +
            'description VARCHAR2(1000), code CLOB, packages VARCHAR2(1000), data_json CLOB, created_by VARCHAR2(100), created_date DATE DEFAULT SYSDATE, changed_by VARCHAR2(100), ' +
            'changed_date DATE, last_run DATE, run_count NUMBER DEFAULT 0, CONSTRAINT wms_ai_code_snippets_uk UNIQUE (name))').then(function () { CODE._table = true; });
    });
};
CODE.loadList = function () {
    return CODE.ensureTable().then(function () {
        return rows("SELECT id, name, language, description, packages, created_by, NVL(changed_by, created_by) AS who, TO_CHAR(NVL(changed_date, created_date), 'YYYY-MM-DD HH24:MI') AS at, " +
            "run_count, TO_CHAR(last_run, 'YYYY-MM-DD HH24:MI') AS last_run, LENGTH(code) AS code_len, LENGTH(data_json) AS data_len FROM wms_ai_code_snippets ORDER BY NVL(changed_date, created_date) DESC", 500);
    }).then(function (r) { CODE.list = r; CODE.renderList(); }).catch(function (e) { $('cw-list').innerHTML = '<p class="sm" style="color:#b91c1c">' + esc(e) + '</p>'; });
};
CODE.renderList = function () {
    var f = ($('cw-filter').value || '').toLowerCase();
    var list = CODE.list.filter(function (s) { return !f || (s.NAME + ' ' + (s.DESCRIPTION || '') + ' ' + s.LANGUAGE).toLowerCase().indexOf(f) >= 0; });
    $('cw-list').innerHTML = list.length ? list.map(function (s) {
        var L = CODE.LANGS[s.LANGUAGE] || { icon: 'fa-solid fa-code', label: s.LANGUAGE };
        return '<div class="cw-item' + (CODE.cur && +CODE.cur.id === +s.ID ? ' on' : '') + '" data-id="' + s.ID + '"><i class="' + L.icon + '"></i><div class="grow"><b>' + esc(s.NAME) + '</b>' +
            (s.DESCRIPTION ? '<div class="sm muted">' + esc(s.DESCRIPTION) + '</div>' : '') + '<div class="sm muted">' + esc(L.label) + ' · ' + esc(s.WHO || '') + ' · ' + esc(s.AT || '') + (+s.RUN_COUNT ? ' · ran ' + s.RUN_COUNT + '×' : '') + (+s.DATA_LEN ? ' · <i class="fa-solid fa-database" title="Has data sources"></i>' : '') + '</div></div>' +
            '<button class="icon" title="Delete" data-del="' + s.ID + '"><i class="fa-regular fa-trash-can"></i></button></div>';
    }).join('') : '<p class="muted sm">' + (CODE.list.length ? 'Nothing matches.' : 'No saved code yet — write something and press Save.') + '</p>';
    $('cw-list').querySelectorAll('.cw-item').forEach(function (el) { el.onclick = function (e) { if (e.target.closest('[data-del]')) return; CODE.open(+el.dataset.id); }; });
    $('cw-list').querySelectorAll('[data-del]').forEach(function (b) { b.onclick = function () { CODE.remove(+b.dataset.del); }; });
};
/** Reads one saved snippet with its full code (CLOB read in 4,000-character pieces). */
CODE.get = function (idOrName) {
    var where = typeof idOrName === 'number' ? 'id = ' + idOrName : 'UPPER(name) = UPPER(' + lit(idOrName) + ')';
    return CODE.ensureTable().then(function () { return rows('SELECT id, name, language, description, packages, LENGTH(code) AS len, LENGTH(data_json) AS dlen FROM wms_ai_code_snippets WHERE ' + where, 1); }).then(function (r) {
        var s = r[0]; if (!s) throw 'No saved code ' + idOrName;
        var n = Math.min(40, Math.max(1, Math.ceil((+s.LEN || 0) / 4000))), m = Math.min(5, Math.ceil((+s.DLEN || 0) / 4000)), cols = [];
        for (var i = 0; i < n; i++) cols.push('TO_CHAR(SUBSTR(code, ' + (i * 4000 + 1) + ', 4000)) AS c' + i);
        for (var k = 0; k < m; k++) cols.push('TO_CHAR(SUBSTR(data_json, ' + (k * 4000 + 1) + ', 4000)) AS d' + k);
        return rows('SELECT ' + cols.join(', ') + ' FROM wms_ai_code_snippets WHERE id = ' + (+s.ID), 1).then(function (p) {
            var code = '', dj = ''; for (var j = 0; j < n; j++) code += (p[0] || {})['C' + j] || '';
            for (var q = 0; q < m; q++) dj += (p[0] || {})['D' + q] || '';
            var data = []; try { data = dj ? JSON.parse(dj) : []; } catch (e) { data = []; }
            return { id: +s.ID, name: s.NAME, language: s.LANGUAGE, description: s.DESCRIPTION || '', packages: s.PACKAGES || '', code: code, data: Array.isArray(data) ? data.slice(0, 3) : [] };
        });
    });
};
CODE.open = function (id) {
    CODE.get(id).then(function (s) {
        CODE.cur = s;
        $('cw-name').value = s.name; $('cw-lang').value = s.language; $('cw-desc').value = s.description; $('cw-pkgs').value = s.packages;
        $('cw-code').value = s.code; CODE.gutter(); CODE.renderList(); CODE.fillInputs();
        CODE.data = s.data.map(function (d) { return { name: String(d.name || ''), src: CODE.SRC_LABEL[d.src] ? d.src : 'FUSION', max: +d.max || 5000, sql: String(d.sql || '') }; });
        CODE.lastData = []; CODE.toggleData(CODE.data.length > 0); CODE.dataCount();
        $('cw-otabs').innerHTML = ''; $('cw-obody').innerHTML = '<p class="muted sm">Press Run (Ctrl+Enter) to run it.</p>';
    }).catch(function (e) { toast(String(e), 'err'); });
};
CODE.newCode = function () {
    CODE.cur = null;
    $('cw-name').value = ''; $('cw-desc').value = ''; $('cw-pkgs').value = '';
    CODE.data = []; CODE.lastData = []; if ($('cw-data')) { CODE.toggleData(false); CODE.dataCount(); }
    $('cw-code').value = CODE.LANGS[$('cw-lang').value].sample; CODE.gutter(); CODE.fillInputs();
    if ($('cw-list')) CODE.renderList();
};
CODE.save = function () {
    var name = $('cw-name').value.trim(), code = $('cw-code').value, lang = $('cw-lang').value;
    if (!name) { $('cw-name').focus(); toast('Give the code a name to save it', 'err'); return; }
    if (code.length > 150000) { toast('Code is too long to save (max 150,000 characters)', 'err'); return; }
    var dj = CODE.data.length ? JSON.stringify(CODE.data) : '';
    if (dj.length > 20000) { toast('The data queries are too long to save (max 20,000 characters together)', 'err'); return; }
    var u = appUser() || 'UNKNOWN';
    CODE.ensureTable().then(function () {
        return dbWrite('MERGE INTO wms_ai_code_snippets t USING (SELECT ' + lit(name.slice(0, 200)) + ' AS name FROM dual) s ON (t.name = s.name) ' +
            'WHEN MATCHED THEN UPDATE SET language = ' + lit(lang) + ', description = ' + vlit($('cw-desc').value, 1000) + ', packages = ' + vlit($('cw-pkgs').value, 1000) +
            ', code = ' + clob(code) + ', data_json = ' + (dj ? clob(dj) : 'NULL') + ', changed_by = ' + lit(u) + ', changed_date = SYSDATE ' +
            'WHEN NOT MATCHED THEN INSERT (name, language, description, packages, code, data_json, created_by) VALUES (s.name, ' + lit(lang) + ', ' + vlit($('cw-desc').value, 1000) + ', ' +
            vlit($('cw-pkgs').value, 1000) + ', ' + clob(code) + ', ' + (dj ? clob(dj) : 'NULL') + ', ' + lit(u) + ')');
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
        return { ok: true, content: 'Saved code "' + s.name + '" (' + s.language + (s.packages ? ', packages ' + s.packages : '') + '): ' + s.description + '\n```' + s.language + '\n' + s.code + '\n```' +
            (s.data.length ? '\nData sources (run by the Code tab before each run, read-only; HTML gets DATA.<name>, other languages <name>.csv):\n' + s.data.map(function (d) { return '- ' + d.name + ' (' + d.src + ', max ' + d.max + '):\n```sql\n' + d.sql + '\n```'; }).join('\n') : '') };
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
CODE.normLang = function (l) { l = String(l || '').toLowerCase(); return { py: 'python', 'c#': 'csharp', cs: 'csharp', js: 'javascript', node: 'javascript', ps1: 'powershell', pwsh: 'powershell', htm: 'html', web: 'html' }[l] || l; };

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
