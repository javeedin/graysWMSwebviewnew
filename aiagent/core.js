/* AI Agent — core: host bridge, conversation loop, live timeline, confirm / question cards, conversations, memory, jobs.
   The brain is the AI Hub (Python, LangGraph): POST /agent/threads runs the graph until it ends or needs the app.
   When it needs the app (interrupt {type:'tools', calls}), this page runs each call — host tools through agentTool
   (C#: Fusion runner, result cache, MRA, inbox), page tools through AG.exec — and resumes. "act" calls show a confirm
   card the host registered first (agentIssue); the host refuses the action without it. Events are polled while a
   turn runs so every step shows live. */
var AG_APEX = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/ai';
var AG = {
    exec: {}, preview: {}, catalog: null, specs: {}, toolsMeta: {}, tid: null, seq: 0, busy: false, threads: [], hub: null,
    pod: 'PROD', model: '', spec: 'auto', results: [], resSel: null, stepEls: {}, pendingCards: 0, autoJobs: true
};

function $(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function hasHost() { return !!(window.chrome && window.chrome.webview); }
function appUser() { try { return sessionStorage.getItem('loggedInUser') || localStorage.getItem('loggedInUser') || ''; } catch (e) { return ''; } }
function ls(k, d) { try { var v = localStorage.getItem('aiagent.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem('aiagent.' + k, JSON.stringify(v)); } catch (e) { } }
function lit(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }
function vlit(s, max) { s = String(s == null ? '' : s).slice(0, max || 4000); return s ? lit(s) : 'NULL'; }
function clob(s) { s = String(s || ''); if (!s) return 'EMPTY_CLOB()'; var p = []; for (var i = 0; i < s.length; i += 1000) p.push('TO_CLOB(' + lit(s.slice(i, i + 1000)) + ')'); return p.join(' || '); }
function money(v) { v = +v || 0; return v === 0 ? '$0' : v < 0.01 ? '$' + v.toFixed(4) : '$' + v.toFixed(2); }
function ago(ts) { var s = Math.max(0, Date.now() / 1000 - ts); return s < 60 ? 'now' : s < 3600 ? Math.round(s / 60) + ' min' : s < 86400 ? Math.round(s / 3600) + ' h' : Math.round(s / 86400) + ' d'; }
function hex16() { var a = new Uint8Array(8); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.random() * 256; }); return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

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
        var id = 'ag_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        _pending[id] = { resolve: resolve, reject: reject };
        if (ms) setTimeout(function () { if (_pending[id]) { delete _pending[id]; reject('The app did not answer in time (' + action + ').'); } }, ms);
        window.chrome.webview.postMessage(Object.assign({ action: action, requestId: id, appUser: appUser() }, payload || {}));
    });
}
if (hasHost()) window.chrome.webview.addEventListener('message', function (ev) {
    var r = ev.data; if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { return; } }
    if (!r || !r.requestId || !_pending[r.requestId]) return;
    var cb = _pending[r.requestId]; delete _pending[r.requestId];
    if (r.action === 'error') cb.reject(r.message || (r.data && r.data.message) || 'Host error'); else cb.resolve(r.data == null ? {} : r.data);
});
function hostOk(action, payload, ms) { return host(action, payload, ms).then(function (d) { if (d && d.ok === false) throw d.error || 'failed'; return d; }); }
function hub(method, path, body) {
    return host('hubApi', { method: method, path: path, body: body }, 900000).then(function (d) {
        if (!d || d.ok === false) throw (d && d.error) || 'AI Hub error';
        return d.result;
    });
}
function apex(path, payload) {
    return host('executePost', { fullUrl: AG_APEX + path, body: JSON.stringify(Object.assign({ appUser: appUser() }, payload)) }, 120000).then(function (data) {
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

// ── markdown-lite ──────────────────────────────────────────────
function md(text) {
    var parts = String(text || '').split(/```(\w*)\n?([\s\S]*?)```/g), out = '';
    for (var i = 0; i < parts.length; i += 3) {
        var t = esc(parts[i]).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
        var lines = t.split('\n'), html = '', inList = false;
        lines.forEach(function (l) {
            var m = l.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)/);
            if (m) { if (!inList) { html += '<ul>'; inList = true; } html += '<li>' + m[1] + '</li>'; }
            else { if (inList) { html += '</ul>'; inList = false; } if (l.trim()) html += '<p>' + l + '</p>'; }
        });
        if (inList) html += '</ul>';
        out += html;
        if (i + 2 < parts.length) out += '<pre data-lang="' + esc(parts[i + 1]) + '">' + esc(parts[i + 2].trim()) + '</pre>';
    }
    return out;
}

// ── catalog / labels ───────────────────────────────────────────
AG.SPEC_COLOR = { fusion_analyst: 'var(--fa)', wms_operator: 'var(--wo)', order_desk: 'var(--od)', data_loader: 'var(--dl)', reporter: 'var(--rp)' };
AG.LABELS = {
    ask_user: 'Question for you', remember: 'Remember', handoff: 'Hand over', open_page: 'Open a page',
    fusion_search_objects: 'Search Fusion objects', fusion_search_columns: 'Search Fusion columns', fusion_describe: 'Describe', fusion_source: 'Read source',
    fusion_dependencies: 'Dependencies', fusion_sql_dry_run: 'Dry run on Fusion', fusion_sql_run: 'Run on Fusion', result_analyze: 'Analyse result', show_chart: 'Chart',
    knowledge_lookup: 'Company knowledge', saved_queries_search: 'Saved queries', saved_query_get: 'Open saved query', save_query: 'Save query',
    knowledge_propose: 'Propose knowledge', watchdogs_status: 'Watchdogs', watchdog_create: 'Create watchdog', flows_list: 'Process flows', setups_status: 'Setup checklist',
    datasets_list: 'APEX datasets', model_search: 'Search Fusion Model', model_evaluate: 'Evaluate measures',
    trips_find: 'Find trips', trip_orders: 'Orders on trip', print_jobs: 'Print jobs', printers_status: 'Printers', mra_status: 'MRA status', mra_interface: 'Send to MRA',
    inbox_list: 'AI inbox', inbox_request: 'Ask an approver', om_orders_find: 'Find orders', om_order_detail: 'Order detail', fusion_order_status: 'Fusion order status',
    om_prepare_order: 'Prepare order', fbdi_templates_find: 'FBDI templates', fbdi_loads: 'FBDI loads', fusion_rest_describe: 'REST fields', fusion_rest_get: 'REST read',
    model_reports: 'Reports & dashboards', make_report: 'Build report', schedule_job: 'Schedule job', jobs_list: 'Scheduled jobs'
};
AG.ICONS = {
    ask_user: 'fa-circle-question', remember: 'fa-brain', handoff: 'fa-people-arrows', open_page: 'fa-up-right-from-square', fusion_sql_dry_run: 'fa-vial',
    fusion_sql_run: 'fa-play', result_analyze: 'fa-calculator', show_chart: 'fa-chart-column', knowledge_lookup: 'fa-book', mra_interface: 'fa-receipt',
    make_report: 'fa-file-lines', schedule_job: 'fa-clock', save_query: 'fa-floppy-disk', watchdog_create: 'fa-shield-dog'
};
AG.label = function (n) { return AG.LABELS[n] || n.replace(/_/g, ' '); };
AG.icon = function (n) { return AG.ICONS[n] || (/^fusion_/.test(n) ? 'fa-magnifying-glass' : 'fa-wrench'); };
/** Register a page tool: fn(input, call) → Promise<{ok, content, data}> */
AG.tool = function (name, fn, preview) { AG.exec[name] = fn; if (preview) AG.preview[name] = preview; };
AG.caps = function () {
    var host = ['fusion_search_objects', 'fusion_search_columns', 'fusion_describe', 'fusion_source', 'fusion_dependencies', 'fusion_sql_dry_run',
        'fusion_sql_run', 'result_analyze', 'mra_interface', 'inbox_list', 'inbox_request'];
    return host.concat(Object.keys(AG.exec));
};

// ── init ───────────────────────────────────────────────────────
AG.init = function () {
    AG.pod = ls('pod', 'PROD'); AG.model = ls('model', ''); AG.spec = ls('spec', 'auto');
    document.querySelectorAll('#pod-seg button').forEach(function (b) { b.onclick = function () { AG.setPod(b.dataset.pod); }; });
    AG.setPod(AG.pod);
    $('model-sel').onchange = function () { AG.model = this.value; lsSet('model', AG.model); };
    $('btn-new').onclick = AG.newChat;
    $('btn-send').onclick = AG.send;
    $('btn-stop').onclick = AG.stop;
    $('btn-memory').onclick = AG.showMemory;
    $('btn-jobs').onclick = AG.showJobs;
    $('btn-help').onclick = AG.showHelp;
    $('btn-rollout').onclick = function () { AG.showRollout(); };
    $('res-collapse').onclick = function () { $('results').parentNode.classList.add('nores'); };
    $('th-filter').oninput = AG.renderThreads;
    var inp = $('input');
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); AG.send(); } });
    inp.addEventListener('input', function () { inp.style.height = 'auto'; inp.style.height = Math.min(160, inp.scrollHeight) + 'px'; });
    AG.renderSpecs();
    AG.checkHub().then(function (ok) {
        if (!ok) return;
        return host('agentMode', {}, 15000).catch(function () { return {}; }).then(function (m) {
            AG.mode = m.mode || 'BETA';
            if (AG.mode === 'OFF' && !m.admin) {
                $('timeline').innerHTML = '<div class="welcome"><div class="card" style="text-align:center;padding:26px"><i class="fa-solid fa-toggle-off" style="font-size:2rem;color:#94a3b8"></i><h2 style="margin-top:10px">The AI Agent is switched off</h2>' +
                    '<p class="muted sm" style="margin-top:6px">Your AI admin has not opened it yet. Use the <a href="../aianalysis/index.html">AI Digital Employee</a> meanwhile.</p></div></div>';
                return false;
            }
            return true;
        });
    }).then(function (ok) {
        if (!ok) return;
        AG.loadCatalog().then(function () {
            AG.renderSpecs();
            AG.loadThreads().then(function () {
                var last = ls('tid', null);
                if (last && AG.threads.some(function (t) { return t.id === last; })) AG.open(last); else AG.welcome();
            });
        });
        AG.loadModels();
        AG.jobTick();
        setInterval(AG.jobTick, 60000);
    });
};
AG.setPod = function (p) {
    AG.pod = p === 'TEST' ? 'TEST' : 'PROD'; lsSet('pod', AG.pod);
    document.querySelectorAll('#pod-seg button').forEach(function (b) { b.classList.toggle('on', b.dataset.pod === AG.pod); });
    AG.meta();
};
AG.checkHub = function () {
    return host('hubStatus', { lines: 0 }, 8000).then(function (st) {
        AG.hub = st;
        $('hubchip').innerHTML = st.running ? '<span class="chip on"><span class="dot"></span>Agent ready</span>' : '<span class="chip off"><span class="dot"></span>' + (st.found && st.venv ? 'AI Hub stopped' : 'AI Hub not installed') + '</span>';
        if (!st.running) AG.offline(st);
        return !!st.running;
    }).catch(function (e) {
        $('hubchip').innerHTML = '<span class="chip bad"><span class="dot"></span>App too old</span>';
        $('timeline').innerHTML = '<div class="welcome"><div class="card"><b>This page needs the Gray\'s WMS app.</b><p class="muted sm">' + esc(e) + '</p></div></div>';
        return false;
    });
};
AG.offline = function (st) {
    var can = st.found && st.venv;
    $('timeline').innerHTML = '<div class="welcome"><div class="card" style="text-align:center;padding:26px"><i class="fa-solid fa-plug-circle-xmark" style="font-size:2rem;color:#94a3b8"></i>' +
        '<h2 style="margin-top:10px">The agent runs in the AI Hub on this PC</h2><p class="muted sm" style="margin:6px 0 14px">' +
        (can ? 'The AI Hub is installed but stopped.' : 'Install the AI Hub once (Python and the libraries, no administrator needed).') + '</p>' +
        (can ? '<button class="btn primary" onclick="AG.startHub()"><i class="fa-solid fa-play"></i> Start the AI Hub</button> ' : '') +
        '<a class="btn" href="../aihub/index.html"><i class="fa-solid fa-diagram-project"></i> Open AI Hub</a></div></div>';
};
AG.startHub = function () {
    hostOk('hubStart', { visible: false }, 20000).then(function () {
        toast('Starting the AI Hub…');
        var n = 0, t = setInterval(function () { AG.checkHub().then(function (ok) { if (ok || ++n > 30) { clearInterval(t); if (ok) { toast('AI Hub running', 'ok'); location.reload(); } } }); }, 1000);
    }).catch(function (e) { toast(String(e), 'err'); });
};
AG.loadCatalog = function () {
    return hub('GET', '/agent/catalog').then(function (c) {
        AG.catalog = c;
        c.specialists.forEach(function (s) { AG.specs[s.id] = s; });
        c.tools.forEach(function (t) { AG.toolsMeta[t.name] = t; });
    }).catch(function (e) { toast('AI Hub: ' + e + ' — update the AI Hub (AI Hub › Overview › Update)', 'err'); });
};
AG.loadModels = function () {
    hub('GET', '/providers').then(function (ps) {
        var sel = $('model-sel'), html = '<option value="">Model: Auto (router)</option>';
        ps.filter(function (p) { return p.enabled && p.configured; }).forEach(function (p) {
            (p.models || []).forEach(function (m) { var v = p.id + '|' + m; html += '<option value="' + esc(v) + '"' + (v === AG.model ? ' selected' : '') + '>' + esc(p.label + ' · ' + m) + '</option>'; });
        });
        sel.innerHTML = html;
    }).catch(function () { });
};
AG.modelBody = function () { if (!AG.model) return null; var p = AG.model.split('|'); return { provider: p[0], model: p.slice(1).join('|') }; };

// ── specialists ────────────────────────────────────────────────
AG.SPEC_LIST = [
    { id: 'auto', title: 'Auto (supervisor)', icon: 'fa-wand-magic-sparkles', color: '#64748b' },
    { id: 'fusion_analyst', title: 'Fusion Analyst', icon: 'fa-database' }, { id: 'wms_operator', title: 'WMS Operator', icon: 'fa-truck-fast' },
    { id: 'order_desk', title: 'Order Desk', icon: 'fa-cart-shopping' }, { id: 'data_loader', title: 'Data Loader', icon: 'fa-file-import' },
    { id: 'reporter', title: 'Reporter', icon: 'fa-chart-line' }
];
AG.specOf = function (id) { return AG.SPEC_LIST.filter(function (s) { return s.id === id; })[0] || AG.SPEC_LIST[1]; };
AG.renderSpecs = function () {
    $('specs').innerHTML = AG.SPEC_LIST.map(function (s) {
        return '<div class="spec' + (AG.spec === s.id ? ' on' : '') + '" data-id="' + s.id + '"><i class="fa-solid ' + s.icon + '" style="background:' + (s.color || AG.SPEC_COLOR[s.id]) + '"></i>' + esc(s.title) + '</div>';
    }).join('');
    document.querySelectorAll('.spec').forEach(function (el) { el.onclick = function () { AG.spec = el.dataset.id; lsSet('spec', AG.spec); AG.renderSpecs(); AG.meta(); }; });
};
AG.meta = function () {
    var el = $('compose-meta'); if (!el) return;
    var s = AG.specOf(AG.spec);
    el.innerHTML = '<span><i class="fa-solid ' + s.icon + '"></i> ' + esc(s.title) + '</span><span>Fusion pod <b>' + AG.pod + '</b></span>' +
        '<span>Nothing changes without your confirm</span><span class="grow"></span><span>' + AG.caps().length + ' tools on this app</span>';
};

// ── conversations ──────────────────────────────────────────────
AG.loadThreads = function () {
    return hub('GET', '/agent/threads?limit=80').then(function (t) { AG.threads = t || []; AG.renderThreads(); }).catch(function () { });
};
AG.renderThreads = function () {
    var f = ($('th-filter').value || '').toLowerCase(), col = { waiting: '#f59e0b', running: '#4f46e5', error: '#dc2626', cancelled: '#94a3b8', done: '#cbd5e1' };
    var list = AG.threads.filter(function (t) { return !f || (t.title || '').toLowerCase().indexOf(f) >= 0; });
    $('threads').innerHTML = list.length ? list.map(function (t) {
        return '<div class="th' + (t.id === AG.tid ? ' on' : '') + '" data-id="' + t.id + '" title="' + esc(t.status) + '"><span class="sd" style="background:' + (col[t.status] || '#cbd5e1') + '"></span><div class="grow" style="min-width:0">' +
            '<div class="t">' + (t.job_id ? '<i class="fa-regular fa-clock"></i> ' : '') + esc(t.title) + '</div><div class="m">' + esc(AG.specOf(t.specialist).title) + ' · ' + ago(t.updated) +
            (t.status === 'waiting' ? ' · <b style="color:#b45309">needs you</b>' : '') + '</div></div></div>';
    }).join('') : '<div class="muted sm" style="padding:8px">No conversations yet.</div>';
    document.querySelectorAll('.th').forEach(function (el) { el.onclick = function () { if (!AG.busy) AG.open(el.dataset.id); }; });
};
AG.newChat = function () {
    if (AG.busy) return;
    AG.tid = null; AG.seq = 0; AG.stepEls = {}; lsSet('tid', null);
    $('cards').innerHTML = ''; AG.results = []; AG.renderResults();
    AG.welcome(); AG.renderThreads(); $('input').focus();
};
AG.welcome = function () {
    $('chat-h').innerHTML = '<b>New conversation</b>';
    var groups = [
        ['fusion_analyst', ['Supplier invoices over 10,000 not paid yet, by supplier', 'How many sales orders were created per day last week?', 'Which items have on-hand below zero?']],
        ['wms_operator', ['Which trips of today are not printed yet?', 'Show failed print jobs of the last 24 hours', 'Is MRA switched on for PROD?']],
        ['order_desk', ['Orders waiting for approval', 'What is the Fusion status of order 1002345?', 'Prepare an order for customer C001: 10 × ITEM-A']],
        ['data_loader', ['Which FBDI template loads supplier sites?', 'What fields does the Fusion invoices REST resource need?', 'Show my FBDI loads']],
        ['reporter', ['Make a report of AP invoices this month by supplier', 'Every morning at 7:30 give me trips not printed', 'Which Fusion Model reports exist?']]
    ];
    $('timeline').innerHTML = '<div class="welcome"><h2>What do you need?</h2><p class="lead">The supervisor picks the right specialist (or choose one on the left). They look things up, check SQL with a dry run, ' +
        'and ask you before anything runs on Fusion or changes data. Everything they do appears below, step by step.</p><div class="sugg">' +
        groups.map(function (g) {
            var s = AG.specOf(g[0]);
            return '<div class="sg"><h5><i class="fa-solid ' + s.icon + '" style="background:' + AG.SPEC_COLOR[s.id] + '"></i>' + esc(s.title) + '</h5>' +
                g[1].map(function (q) { return '<button data-q="' + esc(q) + '">' + esc(q) + '</button>'; }).join('') + '</div>';
        }).join('') + '</div><div class="howit">' + [
            ['Checks before it runs', 'Every Fusion query gets a dry run (row count + sample); errors are fixed before you see a card.'],
            ['You confirm actions', 'Runs on PROD, MRA, saving, schedules: a card shows exactly what — the app refuses anything without it.'],
            ['Remembers you', 'Tell it your BU or how you like amounts; it keeps it (Memory, top right).'],
            ['Shows its work', 'Steps, SQL, model and cost for every answer — and Replay to watch it again.']
        ].map(function (h) { return '<div><b>' + h[0] + '</b>' + h[1] + '</div>'; }).join('') + '</div></div>';
    document.querySelectorAll('.sg button').forEach(function (b) { b.onclick = function () { $('input').value = b.dataset.q; AG.send(); }; });
    AG.meta();
};
AG.open = function (tid) {
    AG.tid = tid; AG.seq = 0; AG.stepEls = {}; lsSet('tid', tid);
    $('timeline').innerHTML = ''; $('cards').innerHTML = '';
    AG.renderThreads();
    return Promise.all([hub('GET', '/agent/threads/' + tid), hub('GET', '/agent/threads/' + tid + '/events?after=0')]).then(function (r) {
        var snap = r[0];
        r[1].events.forEach(AG.renderEvent);
        AG.header(snap);
        AG.results = (snap.results || []).map(function (x) { return { id: x.result_id, title: x.title, rows: x.rows }; });
        AG.renderResults();
        if (snap.waiting && !AG.busy) AG.handleWait(snap);
    }).catch(function (e) { toast(String(e), 'err'); AG.newChat(); });
};
AG.header = function (snap) {
    if (!snap) return;
    var s = AG.specOf(snap.specialist);
    $('chat-h').innerHTML = '<b title="' + esc(snap.title) + '">' + esc(snap.title) + '</b><span class="chip" style="background:' + (AG.SPEC_COLOR[s.id] || '#64748b') + ';color:#fff"><i class="fa-solid ' + s.icon + '"></i> ' + esc(s.title) + '</span>' +
        '<span class="muted sm">' + esc(snap.pod || '') + ' · ' + (snap.turns || 0) + ' model calls · ' + ((snap.tokens_in || 0) + (snap.tokens_out || 0)).toLocaleString() + ' tokens · ' + money(snap.cost) + '</span><span class="grow"></span>' +
        '<button class="icon" title="Replay how the agent worked" onclick="AG.replay()"><i class="fa-solid fa-film"></i></button>' +
        '<button class="icon" title="Copy the conversation" onclick="AG.copyTranscript()"><i class="fa-regular fa-copy"></i></button>' +
        '<button class="icon" title="Delete" onclick="AG.del()"><i class="fa-regular fa-trash-can"></i></button>';
};

// ── send / run loop ────────────────────────────────────────────
AG.send = function () {
    var text = $('input').value.trim();
    if (!text || AG.busy) return;
    if (AG.pendingCards) { toast('Answer the open card first — or press Decline.', 'err'); return; }
    $('input').value = ''; $('input').style.height = '';
    var body = { text: text, pod: AG.pod, caps: AG.caps(), model: AG.modelBody(), specialist: AG.spec === 'auto' ? (AG.tid ? 'auto' : null) : AG.spec };
    var call;
    if (!AG.tid) {
        AG.tid = 'ag_' + hex16(); AG.seq = 0; AG.stepEls = {}; lsSet('tid', AG.tid);
        $('timeline').innerHTML = '';
        body.thread_id = AG.tid;
        call = hub('POST', '/agent/threads', body);
    } else call = hub('POST', '/agent/threads/' + AG.tid + '/send', body);
    AG.run(call);
};
/** One hub call that runs the graph: follow its events live, then handle what it needs. */
AG.run = function (call) {
    AG.setBusy(true);
    var tid = AG.tid, stop = false;
    (function loop() {
        if (stop || tid !== AG.tid) return;
        AG.poll().then(function () { setTimeout(loop, 700); });
    })();
    return call.then(function (snap) {
        stop = true;
        return AG.poll().then(function () {
            AG.setBusy(false);
            AG.header(snap);
            AG.loadThreads();
            if (snap.waiting) return AG.handleWait(snap);
        });
    }).catch(function (e) {
        stop = true; AG.setBusy(false);
        AG.poll();
        AG.errLine(String(e));
        AG.loadThreads();
    });
};
AG.poll = function () {
    if (!AG.tid) return Promise.resolve();
    var tid = AG.tid;
    return hub('GET', '/agent/threads/' + tid + '/events?after=' + AG.seq).then(function (r) {
        if (tid !== AG.tid) return;
        r.events.forEach(AG.renderEvent);
    }).catch(function () { });
};
AG.setBusy = function (b) {
    AG.busy = b;
    $('btn-send').hidden = b; $('btn-stop').hidden = !b;
    if (!b) { var t = document.querySelector('.thinking'); if (t) t.remove(); }
};
AG.stop = function () { if (AG.tid) hub('POST', '/agent/threads/' + AG.tid + '/cancel', {}).then(function () { toast('Stopping after the current step…'); }).catch(function (e) { toast(String(e), 'err'); }); };

/** The graph waits for the app: run every call (cards for act / ask), then resume. */
AG.handleWait = function (snap) {
    var w = snap.waiting || {};
    if (w.type !== 'tools') { AG.errLine('Unknown request from the agent: ' + JSON.stringify(w).slice(0, 200)); return; }
    var calls = w.calls || [], results = {}, tid = snap.thread_id;
    var seqp = Promise.resolve();
    calls.forEach(function (c) {
        seqp = seqp.then(function () {
            if (tid !== AG.tid) return;
            return AG.runCall(c).then(function (r) { results[c.id] = r; }, function (e) { results[c.id] = { ok: false, content: 'Failed in the app: ' + e }; });
        });
    });
    return seqp.then(function () {
        if (tid !== AG.tid) return;
        return AG.run(hub('POST', '/agent/threads/' + tid + '/resume', { value: { results: results } }));
    });
};
AG.runCall = function (c) {
    AG.stepState(c.id, 'run');
    var p;
    if (c.risk === 'ask') p = AG.askCard(c);
    else if (c.risk === 'act') p = host('agentIssue', { tool: c.name, input: c.input, pod: c.pod }, 30000).then(function (pol) {
        if (!pol || pol.ok === false) return { ok: false, content: (pol && pol.error) || 'Refused by the app.' };
        if (pol.mode === 'AUTO') return AG.execute(c, false);
        return AG.confirmCard(c, pol).then(function (d) {
            if (!d.approve) return { ok: false, content: 'The user declined' + (d.reason ? ': ' + d.reason : '.') + ' Do not retry the same thing; ask what to change.' };
            return AG.execute(c, true);
        });
    });
    else p = AG.execute(c, false);
    return p.then(function (r) {
        AG.stepState(c.id, r && r.ok ? 'ok' : 'err');
        if (c.name === 'fusion_sql_dry_run' && r && r.ok && r.data) AG.lastDry[String(c.input.sql || '').replace(/\s+/g, ' ').trim().toLowerCase()] = r.data.count;
        if (r && r.data && r.data.result_id) AG.addResult(r.data);
        return r;
    });
};
AG.execute = function (c, approved) {
    if (c.name === 'result_analyze' && /^pg_/.test((c.input || {}).result_id || '')) return Promise.resolve(AG.analyzeLocal(c.input));
    if (c.runs === 'host') return host('agentTool', { tool: c.name, input: c.input, pod: c.pod, approved: !!approved }, 420000);
    if (c.runs === 'hub') return hostOk('agentConfirm', { tool: c.name, input: c.input, pod: c.pod }, 30000).then(function () { return { ok: true, approved: true, content: 'Confirmed by the user.' }; },
        function (e) { return { ok: false, content: String(e) }; });
    var fn = AG.exec[c.name];
    if (!fn) return Promise.resolve({ ok: false, content: 'This app version has no tool ' + c.name + '.' });
    var gate = c.risk === 'act' && approved ? hostOk('agentConfirm', { tool: c.name, input: c.input, pod: c.pod }, 30000) : Promise.resolve();
    return gate.then(function () { return Promise.resolve(fn(c.input || {}, c)); }).then(function (r) { return r || { ok: true, content: 'OK' }; }, function (e) { return { ok: false, content: String(e && e.message || e) }; });
};

// ── cards ──────────────────────────────────────────────────────
AG.confirmCard = function (c, pol) {
    return new Promise(function (resolve) {
        AG.pendingCards++;
        var el = document.createElement('div'); el.className = 'card confirm';
        var pv = AG.preview[c.name] ? AG.preview[c.name](c.input || {}, c) : '<pre>' + esc(JSON.stringify(c.input, null, 2)) + '</pre>';
        el.innerHTML = '<h4><i class="fa-solid ' + AG.icon(c.name) + '"></i> ' + esc(AG.label(c.name)) + ' <span class="risk act">needs your OK</span></h4>' + pv +
            '<div class="facts"><span class="fact' + (c.pod === 'PROD' ? ' prod' : '') + '">' + esc(c.pod) + '</span><span class="fact">policy ' + esc((pol && pol.policy) || c.policy || '') + ': ' + esc((pol && pol.mode) || 'ASK') + '</span></div>' +
            '<div class="acts"><button class="btn go"><i class="fa-solid fa-check"></i> Approve</button><button class="btn danger"><i class="fa-solid fa-xmark"></i> Decline</button>' +
            '<input type="text" class="reason grow" placeholder="Optional: why not / what to change"></div>';
        var done = function (approve) {
            AG.pendingCards--;
            var reason = el.querySelector('.reason').value.trim();
            el.remove();
            AG.pill((approve ? '✔ Approved: ' : '✖ Declined: ') + AG.label(c.name) + (reason ? ' — ' + reason : ''));
            resolve({ approve: approve, reason: reason });
        };
        el.querySelector('.go').onclick = function () { done(true); };
        el.querySelector('.danger').onclick = function () { done(false); };
        $('cards').appendChild(el);
        el.scrollIntoView({ block: 'nearest' });
    });
};
AG.askCard = function (c) {
    return new Promise(function (resolve) {
        AG.pendingCards++;
        var el = document.createElement('div'); el.className = 'card confirm ask';
        el.innerHTML = '<h4><i class="fa-solid fa-circle-question"></i> ' + esc(c.input.question || 'Question') + '</h4><div class="opts">' +
            (c.input.options || []).map(function (o) { return '<button class="opt" data-v="' + esc(o) + '">' + esc(o) + '</button>'; }).join('') + '</div>' +
            '<div class="acts"><input type="text" class="ans grow" placeholder="Or type your answer…"><button class="btn primary">Answer</button></div>';
        var done = function (v) { if (!v) return; AG.pendingCards--; el.remove(); AG.pill('You answered: ' + v); resolve({ ok: true, content: 'The user answered: ' + v }); };
        el.querySelectorAll('.opt').forEach(function (b) { b.onclick = function () { done(b.dataset.v); }; });
        el.querySelector('.btn.primary').onclick = function () { done(el.querySelector('.ans').value.trim()); };
        el.querySelector('.ans').onkeydown = function (e) { if (e.key === 'Enter') done(this.value.trim()); };
        $('cards').appendChild(el);
        el.querySelector('.ans').focus();
    });
};

// ── timeline ───────────────────────────────────────────────────
AG.renderEvent = function (e) {
    if (e.seq <= AG.seq) return;
    AG.seq = e.seq;
    var tl = $('timeline'), d = e.data || {}, th = tl.querySelector('.thinking');
    if (th && e.kind !== 'thinking') th.remove();
    var html = null;
    switch (e.kind) {
        case 'user':
            html = '<div class="msg user"><div class="av"><i class="fa-solid fa-user"></i></div><div class="bub">' + esc(d.text).replace(/\n/g, '<br>') + '</div></div>';
            break;
        case 'route':
            var s = AG.specOf(d.specialist);
            html = '<div class="divider">' + (d.handoff ? 'handed over to' : 'supervisor →') + ' <span class="chip" style="background:' + AG.SPEC_COLOR[s.id] + '"><i class="fa-solid ' + s.icon + '"></i> ' + esc(s.title) + '</span>' + (d.reason ? '<span>' + esc(d.reason) + '</span>' : '') + '</div>';
            break;
        case 'thinking':
            if (th) th.remove();
            html = '<div class="thinking"><i class="fa-solid fa-circle-notch fa-spin"></i> ' + esc(AG.specOf(d.specialist).title) + ' is thinking…</div>';
            break;
        case 'say':
            var sp = AG.specOf(d.specialist);
            html = '<div class="msg" data-seq="' + e.seq + '"><div class="av" style="background:' + AG.SPEC_COLOR[sp.id] + '"><i class="fa-solid ' + sp.icon + '"></i></div><div class="bub"><div class="who">' + esc(sp.title) +
                (d.model ? '<span class="muted" style="font-weight:600">· ' + esc(d.provider ? d.provider + '/' : '') + esc(d.model) + '</span>' : '') + '</div>' + md(d.text) +
                (d.final ? '<div class="fb"><button title="Good answer" onclick="AG.rate(' + e.seq + ',1,this)"><i class="fa-regular fa-thumbs-up"></i></button><button title="Wrong or unhelpful" onclick="AG.rate(' + e.seq + ',-1,this)"><i class="fa-regular fa-thumbs-down"></i></button>' +
                    '<button title="Copy" onclick="AG.copyText(this)"><i class="fa-regular fa-copy"></i></button></div>' : '') + '</div></div>';
            break;
        case 'call':
            var meta = AG.toolsMeta[d.name] || {};
            var arg = d.name === 'fusion_sql_dry_run' || d.name === 'fusion_sql_run' ? (d.input.sql || '') : JSON.stringify(d.input || {});
            var stepsEl = tl.lastElementChild && tl.lastElementChild.classList.contains('steps') ? tl.lastElementChild : null;
            if (!stepsEl) { stepsEl = document.createElement('div'); stepsEl.className = 'steps'; tl.appendChild(stepsEl); }
            var st = document.createElement('div'); st.className = 'step'; st.id = 'st_' + d.id;
            st.innerHTML = '<div class="sh"><span class="st run"><i class="fa-solid fa-circle-notch fa-spin"></i></span><i class="fa-solid ' + AG.icon(d.name) + ' muted"></i><span class="lbl">' + esc(AG.label(d.name)) + '</span>' +
                (d.risk === 'act' ? '<span class="risk act">confirm</span>' : '') + (meta.runs === 'host' ? '<span class="risk host">app</span>' : '') + '<span class="arg">' + esc(arg.slice(0, 200)) + '</span></div><div class="sb">' + esc(d.name === 'fusion_sql_dry_run' || d.name === 'fusion_sql_run' ? arg : JSON.stringify(d.input, null, 2)) + '</div>';
            st.querySelector('.sh').onclick = function () { st.classList.toggle('open'); };
            stepsEl.appendChild(st);
            AG.stepEls[d.id] = st;
            break;
        case 'result':
            var el = AG.stepEls[d.id] || $('st_' + d.id);
            if (el) {
                AG.stepState(d.id, d.ok ? 'ok' : 'err');
                var sb = el.querySelector('.sb');
                sb.textContent += '\n\n── ' + (d.ok ? 'result' : 'error') + ' ──\n' + (d.text || '');
                if (d.data && d.data.result_id && d.data.row_count != null) {
                    var chip = document.createElement('button'); chip.className = 'btn sm'; chip.style.margin = '0 8px 6px';
                    chip.innerHTML = '<i class="fa-solid fa-table"></i> ' + esc(d.data.title || 'Result') + ' · ' + (d.data.row_count != null ? d.data.row_count + ' rows' : '');
                    chip.onclick = function (ev) { ev.stopPropagation(); AG.addResult(d.data); };
                    el.appendChild(chip);
                    AG.addResult(d.data, true);
                }
                if (d.name === 'show_chart' || d.name === 'make_report') AG.applyView(d.name, d.data);
            }
            break;
        case 'memory':
            html = '<div class="pill"><i class="fa-solid fa-brain"></i> Remembered: ' + esc(d.fact) + '</div>';
            break;
        case 'error':
            html = '<div class="errline"><i class="fa-solid fa-triangle-exclamation"></i> ' + esc(d.text) + '</div>';
            break;
        case 'cancelled':
            html = '<div class="pill">Stopped.</div>';
            break;
    }
    if (html) tl.insertAdjacentHTML('beforeend', html);
    tl.scrollTop = tl.scrollHeight;
};
AG.stepState = function (id, state) {
    var el = AG.stepEls[id] || $('st_' + id); if (!el) return;
    var s = el.querySelector('.st');
    s.className = 'st ' + state;
    s.innerHTML = state === 'run' ? '<i class="fa-solid fa-circle-notch fa-spin"></i>' : state === 'ok' ? '<i class="fa-solid fa-check"></i>' : '<i class="fa-solid fa-xmark"></i>';
    el.classList.toggle('err', state === 'err');
};
AG.pill = function (t) { $('timeline').insertAdjacentHTML('beforeend', '<div class="pill">' + esc(t) + '</div>'); $('timeline').scrollTop = 1e9; };
AG.errLine = function (t) { $('timeline').insertAdjacentHTML('beforeend', '<div class="errline"><i class="fa-solid fa-triangle-exclamation"></i> ' + esc(t) + '</div>'); $('timeline').scrollTop = 1e9; };
AG.rate = function (seq, r, btn) {
    hub('POST', '/agent/threads/' + AG.tid + '/feedback', { seq: seq, rating: r }).then(function () {
        btn.parentNode.querySelectorAll('button').forEach(function (b) { b.classList.remove('on'); }); btn.classList.add('on');
        toast(r > 0 ? 'Thanks — marked as good' : 'Thanks — noted. Tell the agent what was wrong to fix it.', 'ok');
    }).catch(function (e) { toast(String(e), 'err'); });
};
AG.copyText = function (btn) { var t = btn.closest('.bub').innerText; navigator.clipboard.writeText(t).then(function () { toast('Copied', 'ok'); }); };
AG.copyTranscript = function () { navigator.clipboard.writeText($('timeline').innerText).then(function () { toast('Conversation copied', 'ok'); }); };
AG.del = function () {
    if (!AG.tid || AG.busy || !confirm('Delete this conversation?')) return;
    hub('POST', '/agent/threads/' + AG.tid + '/delete', {}).then(function () { AG.newChat(); AG.loadThreads(); }).catch(function (e) { toast(String(e), 'err'); });
};
/** Replay: the timeline rebuilt step by step, as it happened. */
AG.replay = function () {
    if (!AG.tid || AG.busy) return;
    hub('GET', '/agent/threads/' + AG.tid + '/events?after=0').then(function (r) {
        $('timeline').innerHTML = ''; AG.seq = 0; AG.stepEls = {};
        var evs = r.events, i = 0;
        (function next() { if (i >= evs.length) return; AG.renderEvent(evs[i++]); setTimeout(next, evs[i - 1].kind === 'say' ? 650 : 280); })();
    });
};

// ── memory / jobs / help ───────────────────────────────────────
AG.showMemory = function () {
    hub('GET', '/agent/memory').then(function (m) {
        openModal('What the agent remembers about you', m.length ? '<p class="muted sm" style="margin-bottom:8px">Added when you tell it something lasting (your BU, formats, habits). Used in every conversation. Never passwords.</p><table class="t"><tbody>' +
            m.map(function (x) { return '<tr><td>' + esc(x.fact) + '</td><td class="muted">' + ago(x.created) + '</td><td><button class="icon" onclick="AG.forget(' + x.id + ')"><i class="fa-regular fa-trash-can"></i></button></td></tr>'; }).join('') + '</tbody></table>'
            : '<p class="muted">Nothing yet. Say for example “remember that I work for BU Grays Mauritius”.</p>');
    }).catch(function (e) { toast(String(e), 'err'); });
};
AG.forget = function (id) { hub('POST', '/agent/memory/delete', { id: id }).then(AG.showMemory); };
AG.showHelp = function () {
    openModal('How the AI Agent works', '<div style="line-height:1.6">' + [
        '<b>Supervisor + specialists.</b> The supervisor reads your message and picks Fusion Analyst, WMS Operator, Order Desk, Data Loader or Reporter (or you pin one on the left). A specialist can hand over to another one.',
        '<b>Tools, not guesses.</b> Specialists call tools: the Fusion dictionary, company knowledge, saved queries, trips, orders, FBDI templates, the Fusion Model … Each step shows here; click it to see the input and result.',
        '<b>Dry run first.</b> A Fusion query is always checked (row count + 5 rows) before you are asked to run it — the agent cannot skip this; the AI Hub refuses it.',
        '<b>You confirm actions.</b> Running on Fusion, MRA, saving, schedules: the app registers the card it shows you and refuses anything that does not match it exactly. Policies (AI Digital Employee › Policies) can make an action AUTO or DENY it. The AI kill switch stops everything.',
        '<b>Where it runs.</b> The brain is the AI Hub on this PC (LangGraph); models go through the hub router (Claude on AWS / direct, NVIDIA …, budget and data rules). Fusion and database calls run in this app with its own credentials — the AI Hub never sees them.',
        '<b>Conversations wait.</b> Close the app while a card is open — the conversation is saved and the card comes back when you open it.'
    ].map(function (p) { return '<p style="margin-bottom:8px">' + p + '</p>'; }).join('') + '</div>');
};
AG.showJobs = function () {
    Promise.all([hub('GET', '/agent/jobs'), hub('GET', '/agent/jobs/pending')]).then(function (r) {
        var jobs = r[0], pend = r[1];
        openModal('Scheduled jobs', (jobs.length ? '<table class="t"><thead><tr><th>Job</th><th>When</th><th>Last run</th><th></th></tr></thead><tbody>' + jobs.map(function (j) {
            return '<tr><td><b>' + esc(j.name) + '</b><div class="muted sm">' + esc(j.prompt) + '</div></td><td>' + (j.every_min ? 'every ' + j.every_min + ' min' : 'daily ' + esc(j.daily_at)) +
                '<div class="muted sm">next ' + (j.next_run ? new Date(j.next_run * 1000).toLocaleString() : '-') + '</div></td><td>' + (j.last_run ? ago(j.last_run) + ' · ' + esc(j.last_status || '') : '-') +
                (j.last_thread ? '<div><a href="#" onclick="closeModal();AG.open(\'' + j.last_thread + '\');return false">open</a></div>' : '') + '</td><td style="white-space:nowrap">' +
                '<button class="btn sm" onclick="AG.jobPut(\'' + j.id + '\',{run_now:true})">Run now</button> <button class="btn sm" onclick="AG.jobPut(\'' + j.id + '\',{enabled:' + (j.enabled ? 'false' : 'true') + '})">' + (j.enabled ? 'Pause' : 'Resume') + '</button> ' +
                '<button class="icon" onclick="if(confirm(\'Delete this job?\'))AG.jobPut(\'' + j.id + '\',{delete:true})"><i class="fa-regular fa-trash-can"></i></button></td></tr>';
        }).join('') + '</tbody></table>' : '<p class="muted">No jobs. Ask the Reporter e.g. “every morning at 7:30 show me trips not printed”.</p>') +
            (pend.length ? '<h4 style="margin:14px 0 6px">Waiting for you</h4>' + pend.map(function (p) { return '<div class="row"><a href="#" onclick="closeModal();AG.open(\'' + p.thread_id + '\');return false">' + esc(p.title) + '</a></div>'; }).join('') : '') +
            '<p class="muted sm" style="margin-top:10px">Jobs run in the AI Hub. Read-only steps are done by any open AI Agent page; anything that needs a confirm waits here for you.</p>');
    }).catch(function (e) { toast(String(e), 'err'); });
};
AG.jobPut = function (id, body) { hub('PUT', '/agent/jobs/' + id, body).then(function () { toast('Done', 'ok'); AG.showJobs(); AG.loadThreads(); }).catch(function (e) { toast(String(e), 'err'); }); };
/** Every minute: job conversations waiting on read-only steps are carried on here; the rest show as "needs you". */
AG.jobTick = function () {
    hub('GET', '/agent/jobs/pending').then(function (pend) {
        var needs = 0, chain = Promise.resolve();
        pend.forEach(function (snap) {
            var calls = (snap.waiting && snap.waiting.calls) || [];
            var auto = AG.autoJobs && calls.length && calls.every(function (c) { return c.risk === 'read' || c.risk === 'auto'; });
            if (!auto || snap.thread_id === AG.tid) { needs++; return; }
            chain = chain.then(function () {
                var results = {};
                return calls.reduce(function (p, c) { return p.then(function () { return AG.execute(c, false).then(function (r) { results[c.id] = r; }); }); }, Promise.resolve())
                    .then(function () { return hub('POST', '/agent/threads/' + snap.thread_id + '/resume', { value: { results: results } }); }).catch(function () { });
            });
        });
        var b = $('jobs-badge'); b.hidden = !needs; b.textContent = needs;
        chain.then(function () { if (pend.length) AG.loadThreads(); });
    }).catch(function () { });
};
