/* Sales Lens — Setup & data tab: the Python the modelling needs, installed on this PC through the desktop host
   (salesLens* actions, classes/Form1_SalesLensHandlers.cs): Install / Update, the package versions, a self-test on
   made-up data, the live install log. The data part (Fusion history, APEX + DuckDB) follows in Phase 1. */
(function () {
    'use strict';
    var pending = {}, el = null, meta = null, poll = null, busy = '';
    var last = null;   // the last salesLensStatus answer

    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function hasHost() { return !!(window.chrome && window.chrome.webview && window.chrome.webview.postMessage); }
    function appUser() { try { return localStorage.getItem('username') || localStorage.getItem('wms_user') || ''; } catch (e) { return ''; } }

    function host(action, payload, ms) {
        return new Promise(function (resolve, reject) {
            if (!hasHost()) { reject('Open this page inside the Gray\'s WMS app.'); return; }
            var id = 'sl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
            pending[id] = { resolve: resolve, reject: reject };
            setTimeout(function () { if (pending[id]) { delete pending[id]; reject('The app did not answer — update Gray\'s WMS (this build has no Sales Lens setup yet).'); } }, ms || 20000);
            window.chrome.webview.postMessage(Object.assign({ action: action, requestId: id, appUser: appUser() }, payload || {}));
        });
    }
    if (hasHost()) window.chrome.webview.addEventListener('message', function (ev) {
        var r = ev.data; if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { return; } }
        if (!r || !r.requestId || !pending[r.requestId]) return;
        var cb = pending[r.requestId]; delete pending[r.requestId];
        if (r.action === 'error') cb.reject(r.message || 'Host error'); else cb.resolve(r.data == null ? {} : r.data);
    });

    function toast(msg, kind) {
        var t = document.createElement('div'); t.className = 'sl-toast ' + (kind || ''); t.textContent = msg;
        document.body.appendChild(t); setTimeout(function () { t.remove(); }, kind === 'err' ? 7000 : 3500);
    }

    var STATE = { ok: ['fa-circle-check', 'ok'], run: ['fa-spinner fa-spin', 'run'], wait: ['fa-circle', 'wait'], fail: ['fa-circle-xmark', 'fail'], warn: ['fa-triangle-exclamation', 'warn'], skip: ['fa-circle-minus', 'wait'] };

    function pythonCard(s) {
        var v = s && s.versions, job = s && s.job, running = job && job.running;
        var installed = s && s.venv, allOk = v && v.ok, test = s && s.selftest;
        var badge = !s ? '<span class="pill">checking…</span>'
            : running ? '<span class="pill now"><i class="fas fa-spinner fa-spin"></i> installing</span>'
            : !installed ? '<span class="pill bad">not installed</span>'
            : allOk && test && test.ok ? '<span class="pill good"><i class="fas fa-check"></i> ready</span>'
            : allOk ? '<span class="pill warn">installed · run the self-test</span>'
            : '<span class="pill warn">needs attention</span>';
        var dis = running || busy ? ' disabled' : '';
        return '<div class="card"><h2><i class="fab fa-python"></i> Python for Sales Lens ' + badge + '</h2>' +
            '<p class="muted">The forecasts, models and simulations run in Python on this PC. One click installs everything it needs into <code>' + esc((s && s.folder) || 'C:\\fusion\\saleslens') + '</code> — a private Python (no admin, nothing added to PATH, the pipeline server\'s Python is reused when present) and the packages below. Nothing here touches Fusion or APEX.</p>' +
            '<div class="sl-facts">' +
            fact('Python', v && v.python ? v.python : (installed ? 'installed' : '—')) +
            fact('Environment', installed ? '<code>' + esc(s.python) + '</code>' : 'not created yet') +
            fact('Last check', s && s.versionsAt ? esc(s.versionsAt) : '—') +
            fact('Last self-test', s && s.selftestAt ? esc(s.selftestAt) + (test ? (test.ok ? ' · <b class="g">passed</b>' : ' · <b class="r">failed</b>') : '') : '—') +
            '</div>' +
            '<div class="sl-bar">' +
            '<button class="btn pri" data-a="install"' + dis + '><i class="fas fa-download"></i> ' + (installed ? 'Repair / reinstall' : 'Install everything') + '</button>' +
            '<button class="btn" data-a="upgrade"' + (installed ? dis : ' disabled') + '><i class="fas fa-arrows-rotate"></i> Update packages</button>' +
            '<button class="btn" data-a="check"' + (installed ? dis : ' disabled') + '><i class="fas fa-list-check"></i> Check versions</button>' +
            '<button class="btn" data-a="selftest"' + (installed ? dis : ' disabled') + '><i class="fas fa-vial"></i> Run self-test</button>' +
            '<button class="btn ghost" data-a="folder"><i class="fas fa-folder-open"></i> Open folder</button>' +
            (busy ? '<span class="muted small"><i class="fas fa-spinner fa-spin"></i> ' + esc(busy) + '</span>' : '') +
            '</div>' + (s && s.ok === false ? '<p class="r">' + esc(s.error) + '</p>' : '') + '</div>';
    }
    function fact(k, v) { return '<div class="sl-fact"><div class="k">' + esc(k) + '</div><div class="v">' + v + '</div></div>'; }

    function jobCard(job) {
        if (!job) return '';
        var steps = (job.steps || []).map(function (x) {
            var st = STATE[x.state] || STATE.wait;
            return '<div class="sl-step ' + st[1] + '"><i class="fas ' + st[0] + '"></i><b>' + esc(x.label) + '</b><span class="muted small">' + esc(x.detail || '') + '</span></div>';
        }).join('');
        var head = job.running ? '<span class="pill now">running since ' + esc(job.started) + '</span>'
            : job.ok ? '<span class="pill good">finished</span>' : '<span class="pill bad">' + esc(job.error || 'stopped') + '</span>';
        return '<div class="card"><h2><i class="fas fa-gears"></i> Install ' + head + '</h2><div class="sl-steps">' + steps + '</div>' +
            '<details class="sl-log"' + (job.running || !job.ok ? ' open' : '') + '><summary>Log (' + (job.lines || []).length + ' lines)</summary><pre id="sl-log">' +
            esc((job.lines || []).join('\n')) + '</pre></details></div>';
    }

    function packagesCard(v) {
        if (!v) return '<div class="card"><h2><i class="fas fa-cubes"></i> Packages</h2><p class="muted">Not checked yet — install, or press <b>Check versions</b>.</p></div>';
        if (v.ok === false && !v.packages) return '<div class="card"><h2><i class="fas fa-cubes"></i> Packages</h2><p class="r">' + esc(v.error) + '</p></div>';
        var rows = (v.packages || []).map(function (p) {
            var st = p.ok ? '<span class="pill good"><i class="fas fa-check"></i> OK</span>'
                : !p.installed ? '<span class="pill bad">missing</span>'
                : p.error ? '<span class="pill bad">does not load</span>' : '<span class="pill warn">too old</span>';
            return '<tr><td><b>' + esc(p.name) + '</b></td><td>' + esc(p.required || 'any') + '</td><td>' + esc(p.installed || '—') + '</td><td>' + st +
                (p.error ? '<div class="small r">' + esc(p.error) + '</div>' : '') + '</td><td class="small muted">' + esc(USE[p.name] || '') + '</td></tr>';
        }).join('');
        return '<div class="card"><h2><i class="fas fa-cubes"></i> Packages <span class="muted small">Python ' + esc(v.python) + '</span></h2>' +
            '<table class="sl-tbl"><thead><tr><th>Package</th><th>Needs</th><th>Installed</th><th>Status</th><th>Used for</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    }
    var USE = {
        numpy: 'numbers and arrays under everything', pandas: 'order lines, months, customers × items',
        statsmodels: 'baseline forecast (Holt-Winters) — what a customer should have bought',
        'scikit-learn': 'accuracy checks, splits, simple models', lightgbm: 'predictions with the reasons behind each score',
        duckdb: 'the full copy on this PC (same engine version as the app)', pyarrow: 'fast Parquet files between steps', joblib: 'saving trained models'
    };

    function testCard(t, at) {
        if (!t) return '<div class="card"><h2><i class="fas fa-vial"></i> Self-test</h2><p class="muted">Not run yet. It builds a small model on made-up data — no Fusion or APEX — and proves every piece works.</p></div>';
        if (!t.steps) return '<div class="card"><h2><i class="fas fa-vial"></i> Self-test <span class="pill bad">failed</span></h2><p class="r">' + esc(t.error) + '</p></div>';
        var rows = t.steps.map(function (x) {
            return '<tr><td>' + (x.ok ? '<i class="fas fa-circle-check g"></i>' : '<i class="fas fa-circle-xmark r"></i>') + ' ' + esc(x.step) + '</td><td class="' + (x.ok ? '' : 'r') + '">' + esc(x.detail) + '</td><td class="num">' + esc(x.ms) + ' ms</td></tr>';
        }).join('');
        return '<div class="card"><h2><i class="fas fa-vial"></i> Self-test ' + (t.ok ? '<span class="pill good">passed</span>' : '<span class="pill bad">failed</span>') +
            ' <span class="muted small">' + esc(at || '') + '</span></h2><table class="sl-tbl"><tbody>' + rows + '</tbody></table></div>';
    }

    function nextCard() {
        return '<div class="card"><h2><i class="fas fa-database"></i> Data <span class="pill now">Phase 1 · next</span></h2><ul>' +
            (meta ? meta.what : []).map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></div>';
    }

    function paint() {
        if (!el) return;
        var s = last;
        var logEl = document.getElementById('sl-log'), stick = logEl && logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 8;
        el.innerHTML = '<div class="sl-grid">' + pythonCard(s) + jobCard(s && s.job) + packagesCard(s && s.versions) + testCard(s && s.selftest, s && s.selftestAt) + nextCard() + '</div>';
        logEl = document.getElementById('sl-log'); if (logEl && (stick || (s && s.job && s.job.running))) logEl.scrollTop = logEl.scrollHeight;
    }

    function refresh() {
        return host('salesLensStatus').then(function (s) {
            last = s; paint();
            clearTimeout(poll);
            if (s.job && s.job.running && el) poll = setTimeout(refresh, 1500);
        }).catch(function (e) { last = { ok: false, error: String(e) }; paint(); });
    }

    function act(a) {
        if (a === 'folder') { host('salesLensOpenFolder').catch(function (e) { toast(String(e), 'err'); }); return; }
        if (a === 'install' || a === 'upgrade') {
            var msg = a === 'upgrade' ? 'Update every Sales Lens package to the newest allowed version?' :
                'Install Python and the Sales Lens packages on this PC?\n\nAbout 250 MB is downloaded the first time (python.org and pypi.org). It takes a few minutes; you can keep working.';
            if (!window.confirm(msg)) return;
            host('salesLensInstall', { upgrade: a === 'upgrade' }).then(function (r) {
                if (r.ok === false) { toast(r.error, 'err'); return; }
                toast(r.message || 'Started'); refresh();
            }).catch(function (e) { toast(String(e), 'err'); });
            return;
        }
        busy = a === 'check' ? 'checking the versions…' : 'running the self-test (up to a minute)…'; paint();
        host(a === 'check' ? 'salesLensCheck' : 'salesLensSelfTest', {}, a === 'check' ? 150000 : 330000).then(function (r) {
            busy = '';
            if (r.ok === false && r.error && !r.packages && !r.steps) toast(r.error, 'err');
            else toast(r.ok ? (a === 'check' ? 'Every package is installed and loads.' : 'Self-test passed.') : (a === 'check' ? 'A package needs attention.' : 'The self-test failed — see the table.'), r.ok ? '' : 'err');
            return refresh();
        }).catch(function (e) { busy = ''; toast(String(e), 'err'); paint(); });
    }

    window.SalesLensSetup = {
        render: function (main, t) {
            el = main; meta = t; paint();
            el.onclick = function (e) { var b = e.target.closest('button[data-a]'); if (b && !b.disabled) act(b.dataset.a); };
            refresh();
        },
        leave: function () { clearTimeout(poll); if (el) el.onclick = null; el = null; },
        refresh: refresh,
        state: function () { return last; }
    };
})();
