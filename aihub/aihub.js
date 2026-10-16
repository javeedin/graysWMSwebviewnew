/* AI Hub — core: host bridge, APEX / Fusion helpers, tabs, Overview (install, start / stop, log, how it fits).
   The page talks to the Python hub only through the host action hubApi (the host holds the token, checks the AI kill
   switch and writes WMS_AI_AUDIT). Cloud keys are sent once to the hub (Windows Credential Manager) and never kept here. */
var AH_APEX = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/ai';
var AH = { tab: 'overview', st: null, cfg: null, providers: [], timer: null, follow: true, jobWasRunning: false, loaded: {} };

function $(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function hasHost() { return !!(window.chrome && window.chrome.webview); }
function appUser() { try { return sessionStorage.getItem('loggedInUser') || localStorage.getItem('loggedInUser') || ''; } catch (e) { return ''; } }
function ls(k, d) { try { var v = localStorage.getItem('aihub.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem('aihub.' + k, JSON.stringify(v)); } catch (e) { } }
function money(v) { v = +v || 0; return v === 0 ? '$0' : v < 0.01 ? '$' + v.toFixed(4) : '$' + v.toFixed(2); }
function lit(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }
function vlit(s, max) { s = String(s == null ? '' : s).slice(0, max || 4000); return s ? lit(s) : 'NULL'; }
function clob(s) { s = String(s || ''); if (!s) return 'EMPTY_CLOB()'; var p = []; for (var i = 0; i < s.length; i += 1000) p.push('TO_CLOB(' + lit(s.slice(i, i + 1000)) + ')'); return p.join(' || '); }

function toast(msg, kind) {
    var el = document.createElement('div'); el.className = 'toast ' + (kind || ''); el.textContent = msg;
    $('toasts').appendChild(el); setTimeout(function () { el.remove(); }, kind === 'err' ? 7000 : 3500);
}
function openModal(title, html, buttons) {
    $('modal-t').textContent = title; $('modal-b').innerHTML = html; var f = $('modal-f'); f.innerHTML = '';
    (buttons || [{ label: 'Close', onClick: closeModal }]).forEach(function (b) { var e = document.createElement('button'); e.className = 'btn ' + (b.cls || ''); e.innerHTML = b.label; e.onclick = b.onClick; f.appendChild(e); });
    $('modal').classList.add('open');
}
function closeModal() { $('modal').classList.remove('open'); }
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

// ── bridge ─────────────────────────────────────────────────────
var _pending = {};
function host(action, payload, ms) {
    return new Promise(function (resolve, reject) {
        if (!hasHost()) { reject('Open this page inside the Gray\'s WMS app.'); return; }
        var id = 'ah_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        _pending[id] = { resolve: resolve, reject: reject };
        if (ms) setTimeout(function () { if (_pending[id]) { delete _pending[id]; reject('The app did not answer — update Gray\'s WMS to use the AI Hub.'); } }, ms);
        window.chrome.webview.postMessage(Object.assign({ action: action, requestId: id, appUser: appUser() }, payload || {}));
    });
}
if (hasHost()) window.chrome.webview.addEventListener('message', function (ev) {
    var r = ev.data; if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { return; } }
    if (!r || !r.requestId || !_pending[r.requestId]) return;
    var cb = _pending[r.requestId]; delete _pending[r.requestId];
    if (r.action === 'error') cb.reject(r.message || 'Host error'); else cb.resolve(r.data == null ? {} : r.data);
});
function hostOk(action, payload, ms) { return host(action, payload, ms).then(function (d) { if (d && d.ok === false) throw d.error || 'failed'; return d; }); }
/** The hub's HTTP API through the host relay → result JSON. */
function hub(method, path, body) {
    return host('hubApi', { method: method, path: path, body: body }, 600000).then(function (d) {
        if (!d || d.ok === false) throw (d && d.error) || 'AI Hub error';
        return d.result;
    });
}
function apex(path, payload) {
    return host('executePost', { fullUrl: AH_APEX + path, body: JSON.stringify(Object.assign({ appUser: appUser() }, payload)) }).then(function (data) {
        var d = data; if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { throw 'Unexpected database response'; } }
        if (!d || d.success === false) throw (d && d.error) || 'Database API error';
        return d;
    });
}
function rows(sql, max) {
    return apex('/executequery', { sql: sql, maxRows: max || 500 }).then(function (d) {
        var cols = (d.columns || []).map(function (c) { return String(c.name || c).toUpperCase(); });
        return (d.rows || []).map(function (r) { if (!Array.isArray(r)) { var o = {}; Object.keys(r).forEach(function (k) { o[k.toUpperCase()] = r[k]; }); return o; } var x = {}; cols.forEach(function (c, i) { x[c] = r[i]; }); return x; });
    });
}
function dbWrite(sql) { return apex('/executewrite', { sql: sql }); }
/** Read-only SQL on Fusion through the app's BI Publisher runner. */
function fusion(sql, rowLimit, instance) {
    return host('fusionSqlExecute', { sql: sql, rowLimit: rowLimit || 200, instance: instance || ls('pod', 'PROD') }, 300000).then(function (r) {
        if (!r || !r.success) throw (r && r.error) || 'Fusion query failed';
        return r;
    });
}

// ── tabs ───────────────────────────────────────────────────────
AH.show = function (tab) {
    AH.tab = tab; lsSet('tab', tab);
    document.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === tab); });
    document.querySelectorAll('.page').forEach(function (p) { p.hidden = p.id !== 'page-' + tab; });
    var fn = { overview: AH.renderOverview, providers: window.provRender, playground: window.pgRender, router: window.rtRender, usage: window.usRender, evals: window.evRender, doctor: window.dcRender }[tab];
    if (fn) fn();
};
AH.init = function () {
    document.querySelectorAll('.tab').forEach(function (b) { b.onclick = function () { AH.show(b.dataset.tab); }; });
    AH.show(ls('tab', 'overview'));
    AH.refresh();
    AH.timer = setInterval(function () { if (AH.tab === 'overview' || (AH.st && AH.st.job && AH.st.job.running)) AH.refresh(); else AH.refresh(true); }, 4000);
};
/** Hub status (host side: folder, install job, process, log). quiet = only the header chip. */
AH.refresh = function (quiet) {
    return host('hubStatus', { lines: 160 }, 8000).then(function (st) {
        AH.st = st;
        var job = st.job;
        if (job && !job.running && AH.jobWasRunning) { AH.jobWasRunning = false; AH.afterInstall(job); }
        if (job && job.running) AH.jobWasRunning = true;
        AH.chip();
        if (!quiet && AH.tab === 'overview') AH.renderOverview();
        return st;
    }).catch(function (e) { AH.st = { error: String(e) }; AH.chip(); if (AH.tab === 'overview') AH.renderOverview(); });
};
AH.chip = function () {
    var st = AH.st || {}, el = $('hubchip');
    el.innerHTML = st.error ? '<span class="chip bad"><span class="dot"></span>App too old</span>' : !st.found || !st.venv ? '<span class="chip off"><span class="dot"></span>Not installed</span>' :
        st.running ? '<span class="chip on"><span class="dot"></span>Hub running · :' + st.port + '</span>' : '<span class="chip off"><span class="dot"></span>Hub stopped</span>';
};
/** Calls that need the running hub: tell the user how to start it. */
AH.need = function (el) {
    var st = AH.st || {};
    if (st.running) return false;
    el.innerHTML = '<div class="card empty"><i class="fa-solid fa-plug-circle-xmark" style="font-size:1.6rem;color:#94a3b8"></i><p style="margin-top:8px">' +
        (st.found && st.venv ? 'The AI Hub is stopped.' : 'The AI Hub is not installed on this PC yet.') + '</p><p style="margin-top:10px"><button class="btn primary" onclick="AH.show(\'overview\')">Go to Overview</button></p></div>';
    return true;
};

// ── overview ───────────────────────────────────────────────────
AH.renderOverview = function () {
    var el = $('page-overview'), st = AH.st;
    if (!st) { el.innerHTML = '<div class="empty"><i class="fa-solid fa-spinner fa-spin"></i> Checking this PC…</div>'; return; }
    if (st.error) { el.innerHTML = '<div class="card err">' + esc(st.error) + '</div>'; return; }
    var job = st.job, busy = job && job.running, ready = st.found && st.venv && st.configured;
    var state = busy ? 'Installing…' : !ready ? 'Not installed' : st.running ? 'Running' : 'Stopped';
    var html = '<div class="hero ' + (st.running ? 'on' : 'off') + '"><div class="orb"></div><div class="grow"><div class="big">' + state +
        (st.running ? ' <span class="muted sm">127.0.0.1:' + st.port + (st.pid ? ' · pid ' + st.pid : '') + (st.version ? ' · v' + esc(st.version) : '') + '</span>' : '') + '</div>' +
        '<div class="muted sm">' + (busy ? 'Follow the steps below.' : !ready ? 'One click installs Python (private copy), the Anthropic SDK, boto3, LangGraph and LangChain — no PowerShell, no administrator.' :
            st.running ? 'Local only (127.0.0.1): the app relays to it with a token this PC keeps encrypted.' : 'Start it to use the providers, playground, evals and the Pipeline Doctor.') + '</div></div><div class="row">';
    if (!ready || st.update) html += '<label class="row sm"><input type="checkbox" id="ov-key" ' + (st.hasAppClaudeKey !== false ? 'checked' : '') + '> copy this app\'s Claude key</label>' +
        '<button class="btn primary" onclick="AH.install()"' + (busy || (!st.found && !st.canInstall) ? ' disabled' : '') + '><i class="fa-solid fa-download"></i> ' + (st.update ? 'Update to v' + esc(st.bundledVersion) : st.found && st.venv ? 'Repair' : 'Install') + '</button>';
    if (ready && !busy) html += st.running ? '<button class="btn" onclick="AH.stop()"><i class="fa-solid fa-stop"></i> Stop</button>' :
        '<label class="row sm"><input type="checkbox" id="ov-vis" ' + (ls('visible', false) ? 'checked' : '') + ' onchange="lsSet(\'visible\', this.checked)"> show its window</label><button class="btn primary" onclick="AH.start()"><i class="fa-solid fa-play"></i> Start</button>';
    if (ready && st.hasAppClaudeKey) html += '<button class="btn" onclick="AH.copyKey()" title="Claude (direct) uses the key saved in AI settings"><i class="fa-solid fa-key"></i> Copy app Claude key</button>';
    html += '</div></div>';
    if (!st.found && !st.canInstall) html += '<div class="card err" style="margin-top:10px">This app build has no copy of the AI Hub — copy the <code>ai-hub</code> folder from the repository to <code>C:\\fusion\\ai-hub</code>.</div>';
    if (job && (busy || !job.ok)) {
        var ic = { wait: 'fa-regular fa-circle', run: 'fa-solid fa-spinner fa-spin', ok: 'fa-solid fa-check ok', skip: 'fa-solid fa-minus', warn: 'fa-solid fa-triangle-exclamation', fail: 'fa-solid fa-xmark err' };
        html += '<div class="card" style="margin-top:12px"><h3><i class="fa-solid fa-box-open"></i> ' + (busy ? 'Installing…' : job.ok ? 'Installed' : 'Install failed') + '</h3><div class="jsteps">' +
            job.steps.map(function (s) { return '<div class="js ' + s.state + '"><i class="' + (ic[s.state] || '') + '"></i><b>' + esc(s.label) + '</b><span>' + esc(s.detail || '') + '</span></div>'; }).join('') + '</div>' +
            (job.error ? '<p class="err sm" style="margin-top:8px">' + esc(job.error) + '</p>' : '') + '</div>';
    }
    var lines = busy ? job.lines : st.log || [];
    html += '<div class="grid g2" style="margin-top:12px"><div class="card"><div class="row" style="margin-bottom:8px"><h3 style="margin:0"><i class="fa-solid fa-terminal"></i> ' + (busy ? 'Install output' : 'Hub log') + '</h3><span class="grow"></span>' +
        '<label class="sm muted row"><input type="checkbox" ' + (AH.follow ? 'checked' : '') + ' onchange="AH.follow=this.checked"> follow</label>' +
        (st.found ? '<button class="icon" title="Open the log" onclick="host(\'hubOpenLog\')"><i class="fa-solid fa-up-right-from-square"></i></button><button class="icon" title="Open the folder" onclick="host(\'hubOpenFolder\')"><i class="fa-regular fa-folder-open"></i></button>' : '') + '</div>' +
        '<div class="log" id="ov-log">' + (lines.length ? lines.map(function (l) { var c = /ERROR|Traceback|FAILED|Exception/.test(l) ? 'e' : /WARN/.test(l) ? 'w' : /^(=====|> )/.test(l) ? 'm' : /Uvicorn running|Done\.|imports ok|Successfully/.test(l) ? 'o' : ''; return '<div class="' + c + '">' + esc(l) + '</div>'; }).join('') : '<div>(nothing yet)</div>') + '</div></div>' +
        '<div class="card"><h3><i class="fa-solid fa-sitemap"></i> How it fits together</h3>' + AH.archSvg() + '</div></div>';
    html += '<div class="grid g3" style="margin-top:12px">' + [
        ['fa-cloud', 'Multi-cloud, one call', 'Every AI feature asks the hub for a task (fusion_sql, pipeline_doctor …); the router picks Claude in Amazon Bedrock, Claude Platform on AWS, Claude direct, other Bedrock models or NVIDIA NIM — with fallback when one fails or refuses.'],
        ['fa-shield-halved', 'Data stays where it may', 'Each provider is allowed only some data classes (public / internal / fusion-data / personal). A task with Fusion data never reaches a provider that is not allowed to see it.'],
        ['fa-coins', 'Cost under control', 'Every call is priced and logged (hub ledger + WMS_AI_AUDIT). A monthly budget stops paid models; the AI kill switch stops everything.'],
        ['fa-ranking-star', 'Proof, not opinions', 'Evals run the team\'s verified Fusion questions through each model and compare the RESULTS on Fusion — a scoreboard of accuracy, speed and cost per correct answer.'],
        ['fa-user-doctor', 'LangGraph agent with a human in the loop', 'The Pipeline Doctor reads a failed pipeline run, tests its fix on the source, waits for your approval (for days if needed — state is checkpointed), then patches the task and re-runs it.'],
        ['fa-link', 'LangChain-ready', 'GatewayChatModel puts the router behind LangChain\'s chat-model interface, so any LangChain / LangGraph code gets routing, budget and audit for free.']
    ].map(function (w) { return '<div class="why"><b><i class="fa-solid ' + w[0] + '"></i> ' + w[1] + '</b>' + w[2] + '</div>'; }).join('') + '</div>';
    var keep = $('ov-log') && !AH.follow ? $('ov-log').scrollTop : null;
    el.innerHTML = '<h2><i class="fa-solid fa-gauge-high"></i> AI Hub on this PC</h2><p class="lead">A small Python service next to the app. It is the only place that holds cloud keys, and the only thing that talks to the model providers.</p>' + html;
    var lg = $('ov-log'); if (lg) lg.scrollTop = keep != null ? keep : lg.scrollHeight;
};
AH.archSvg = function () {
    var box = function (x, y, w, h, t, s, fill, stroke) { return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="9" fill="' + fill + '" stroke="' + stroke + '"/><text x="' + (x + w / 2) + '" y="' + (y + h / 2 - (s ? 3 : -4)) + '" text-anchor="middle" font-size="12" font-weight="700" fill="#0f172a">' + t + '</text>' + (s ? '<text x="' + (x + w / 2) + '" y="' + (y + h / 2 + 12) + '" text-anchor="middle" font-size="10" fill="#475569">' + s + '</text>' : ''); };
    var ar = function (x1, y1, x2, y2) { return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="#94a3b8" stroke-width="1.5" marker-end="url(#ah-ar)"/>'; };
    var prov = [['Claude · Bedrock', '#fff7ed', '#fdba74'], ['Claude Platform on AWS', '#fff7ed', '#fdba74'], ['Bedrock: Nova · Llama', '#fff7ed', '#fdba74'], ['Claude API', '#f5f3ff', '#c4b5fd'], ['NVIDIA NIM', '#f7fee7', '#bef264']];
    var s = '<svg class="arch" viewBox="0 0 560 250" role="img" aria-label="WMS pages call the host relay, which calls the AI Hub router, which calls the cloud providers">' +
        '<defs><marker id="ah-ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="#94a3b8"/></marker></defs>' +
        box(4, 20, 120, 54, 'WMS pages', 'Fusion SQL · agents', '#f8fafc', '#cbd5e1') +
        box(4, 110, 120, 66, 'Host relay', 'token · kill switch · audit', '#f0fdfa', '#5eead4') +
        '<rect x="160" y="70" width="150" height="110" rx="9" fill="#ecfeff" stroke="#14b8a6"/><text x="235" y="96" text-anchor="middle" font-size="13" font-weight="800" fill="#0f172a">AI Hub (Python)</text>' +
        '<text x="235" y="120" text-anchor="middle" font-size="10" fill="#334155">router · fallback · budget</text><text x="235" y="135" text-anchor="middle" font-size="10" fill="#334155">usage ledger · evals</text><text x="235" y="150" text-anchor="middle" font-size="10" fill="#334155">LangGraph · LangChain</text>' +
        ar(64, 74, 64, 108) + ar(124, 140, 158, 128);
    prov.forEach(function (p, i) { var y = 6 + i * 48; s += box(350, y, 200, 38, p[0], '', p[1], p[2]) + ar(310, 125, 348, y + 19); });
    return s + '</svg>';
};
AH.install = function () {
    var useKey = $('ov-key') ? $('ov-key').checked : true;
    hostOk('hubInstall', { useClaudeKey: useKey, port: 8100 }, 20000).then(function (r) { toast(r.message || 'Installing'); AH.jobWasRunning = true; AH.refresh(); })
        .catch(function (e) { toast(String(e), 'err'); });
};
AH.afterInstall = function (job) {
    if (!job.ok) { toast('Install failed: ' + (job.error || ''), 'err'); return; }
    toast('AI Hub installed — starting it', 'ok');
    AH.start();
};
AH.start = function () {
    hostOk('hubStart', { visible: !!ls('visible', false) }, 20000).then(function (r) {
        toast(r.message || 'Starting');
        var n = 0, t = setInterval(function () { AH.refresh().then(function (st) { if ((st && st.running) || ++n > 30) { clearInterval(t); if (st && st.running) { toast('AI Hub running', 'ok'); AH.loaded = {}; } } }); }, 1000);
    }).catch(function (e) { toast(String(e), 'err'); });
};
AH.stop = function () {
    hostOk('hubStop', {}, 30000).then(function (r) { toast(r.message || 'Stopped'); AH.refresh(); }).catch(function (e) { toast(String(e), 'err'); });
};
AH.copyKey = function () {
    hostOk('hubSaveClaudeKey', {}, 70000).then(function (r) { toast(r.message, 'ok'); }).catch(function (e) { toast(String(e), 'err'); });
};
/** Hub config + providers (cached per page view; force = reload). */
AH.loadConfig = function (force) {
    if (!force && AH.cfg && AH.providers.length) return Promise.resolve();
    return Promise.all([hub('GET', '/config'), hub('GET', '/providers')]).then(function (r) { AH.cfg = r[0]; AH.providers = r[1]; });
};
AH.provName = function (id) { var p = AH.providers.filter(function (x) { return x.id === id; })[0]; return p ? p.label : id; };
/** Fixed colour per provider (entity, never rank) - categorical slots 1..6 in provider order. */
AH.provColor = function (id) { return { bedrock: 'var(--s1)', 'bedrock-converse': 'var(--s2)', 'claude-aws': 'var(--s3)', anthropic: 'var(--s4)', nvidia: 'var(--s6)', demo: '#94a3b8' }[id] || '#64748b'; };
AH.provHex = function (id) { return { bedrock: '#2a78d6', 'bedrock-converse': '#eb6834', 'claude-aws': '#1baf7a', anthropic: '#eda100', nvidia: '#008300', demo: '#94a3b8' }[id] || '#64748b'; };
