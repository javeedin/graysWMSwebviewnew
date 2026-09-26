/* ═══════════════════════════════════════════════════════════════
   Fusion SQL — Data pipeline setups (Setups tab › Data pipeline setups)
   • Pipeline servers: the Python FastAPI service that runs pipelines
     on a schedule (host/IP, port, API user/token, timezone…). "Test"
     calls GET /health and GET /public-key and stores the server's
     RSA public key.
   • Connections: target (and source) databases — Oracle (EZ connect,
     TNS, ADB wallet), APEX REST, SQL Server, MySQL, PostgreSQL.
     Passwords are encrypted HERE with the server's public key
     (RSA-OAEP / SHA-256); APEX stores only the ciphertext and only
     the pipeline server can decrypt it.
   Tables: WMS_PIPE_SERVERS, WMS_PIPE_CONNECTIONS
   (apex_sql/69_fusion_pipelines.sql — auto-created here).
   Calls to the server go through the host's executeGet/executePost
   relay with HTTP Basic auth (api_user / api_token).
   ═══════════════════════════════════════════════════════════════ */

var PS = { state: 'idle', error: null, servers: [], conns: [], sel: null, testing: {} };
var PS_DDL = {
    WMS_PIPE_SERVERS: [
        'CREATE TABLE wms_pipe_servers (server_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, server_name VARCHAR2(100) NOT NULL, ' +
        "protocol VARCHAR2(5) DEFAULT 'http' NOT NULL, host VARCHAR2(255) NOT NULL, port NUMBER(5) DEFAULT 8000 NOT NULL, base_path VARCHAR2(200) DEFAULT '/', " +
        "api_user VARCHAR2(100), api_token VARCHAR2(400), public_key VARCHAR2(4000), key_fingerprint VARCHAR2(100), timezone VARCHAR2(60) DEFAULT 'UTC', " +
        "poll_seconds NUMBER DEFAULT 30, max_parallel NUMBER DEFAULT 4, is_default VARCHAR2(1) DEFAULT 'N' CHECK (is_default IN ('Y','N')), " +
        "active VARCHAR2(1) DEFAULT 'Y' CHECK (active IN ('Y','N')), status VARCHAR2(20), server_version VARCHAR2(60), last_heartbeat TIMESTAMP, " +
        'last_test_date DATE, last_test_msg VARCHAR2(4000), notes VARCHAR2(2000), created_by VARCHAR2(120), created_date DATE DEFAULT SYSDATE, updated_by VARCHAR2(120), updated_date DATE)',
        'CREATE UNIQUE INDEX wms_pipe_servers_name_ux ON wms_pipe_servers (UPPER(server_name))'
    ],
    WMS_PIPE_CONNECTIONS: [
        'CREATE TABLE wms_pipe_connections (conn_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, conn_name VARCHAR2(100) NOT NULL, ' +
        'conn_type VARCHAR2(20) NOT NULL, server_id NUMBER, host VARCHAR2(255), port NUMBER(5), service_name VARCHAR2(200), database_name VARCHAR2(200), ' +
        'tns_alias VARCHAR2(200), tns_descriptor VARCHAR2(4000), wallet_path VARCHAR2(500), rest_url VARCHAR2(1000), auth_type VARCHAR2(20), ' +
        'username VARCHAR2(200), password_enc VARCHAR2(4000), default_schema VARCHAR2(128), options_json VARCHAR2(4000), ' +
        "active VARCHAR2(1) DEFAULT 'Y' CHECK (active IN ('Y','N')), last_test_status VARCHAR2(20), last_test_date DATE, last_test_msg VARCHAR2(4000), " +
        'notes VARCHAR2(2000), created_by VARCHAR2(120), created_date DATE DEFAULT SYSDATE, updated_by VARCHAR2(120), updated_date DATE, ' +
        "CONSTRAINT wms_pipe_conn_type_ck CHECK (conn_type IN ('ORACLE_EZ','ORACLE_TNS','ORACLE_WALLET','APEX_REST','MSSQL','MYSQL','POSTGRES')))",
        'CREATE UNIQUE INDEX wms_pipe_connections_name_ux ON wms_pipe_connections (UPPER(conn_name))'
    ]
};
var PS_TYPES = {
    ORACLE_EZ: { label: 'Oracle', sub: 'host · port · service', icon: 'fa-database', color: '#c74634', port: 1521, fields: ['host', 'port', 'service_name', 'username', 'password', 'default_schema'] },
    ORACLE_TNS: { label: 'Oracle (TNS)', sub: 'alias or descriptor', icon: 'fa-database', color: '#c74634', fields: ['tns_alias', 'tns_descriptor', 'username', 'password', 'default_schema'] },
    ORACLE_WALLET: { label: 'Oracle Autonomous', sub: 'ADB with wallet', icon: 'fa-cloud', color: '#c74634', fields: ['service_name', 'wallet_path', 'username', 'password', 'default_schema'] },
    APEX_REST: { label: 'APEX REST API', sub: 'ORDS endpoint', icon: 'fa-plug', color: '#2a78d6', fields: ['rest_url', 'auth_type', 'username', 'password'] },
    MSSQL: { label: 'SQL Server', sub: 'host · port · database', icon: 'fa-server', color: '#4a3aa7', port: 1433, fields: ['host', 'port', 'database_name', 'username', 'password', 'default_schema', 'opt_encrypt', 'opt_trust'] },
    MYSQL: { label: 'MySQL', sub: 'host · port · database', icon: 'fa-server', color: '#0f766e', port: 3306, fields: ['host', 'port', 'database_name', 'username', 'password', 'opt_ssl'] },
    POSTGRES: { label: 'PostgreSQL', sub: 'host · port · database', icon: 'fa-server', color: '#2563eb', port: 5432, fields: ['host', 'port', 'database_name', 'username', 'password', 'default_schema', 'opt_sslmode'] }
};
var PS_FIELDS = {
    host: ['Host / IP', 'e.g. 10.0.0.25 or db.company.com'],
    port: ['Port', ''],
    service_name: ['Service name', 'e.g. ORCLPDB1 or myadb_high'],
    database_name: ['Database', 'e.g. WMS_DW'],
    tns_alias: ['TNS alias', 'alias in tnsnames.ora on the pipeline server'],
    tns_descriptor: ['TNS descriptor (optional)', '(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=…)(PORT=1521))(CONNECT_DATA=(SERVICE_NAME=…)))'],
    wallet_path: ['Wallet folder on the pipeline server', 'e.g. /opt/pipeline/wallets/myadb'],
    rest_url: ['Base URL', 'https://…/ords/WKSP_…/…/'],
    auth_type: ['Authentication', ''],
    username: ['User name', ''],
    password: ['Password', ''],
    default_schema: ['Default schema (optional)', 'tables are created / written here'],
    opt_encrypt: ['Encrypt connection', ''],
    opt_trust: ['Trust server certificate', ''],
    opt_ssl: ['Use SSL', ''],
    opt_sslmode: ['SSL mode', '']
};

// ── tables & loading ───────────────────────────────────────────
function psEnsureTables() {
    return dbRead("SELECT table_name FROM user_tables WHERE table_name IN ('WMS_PIPE_SERVERS','WMS_PIPE_CONNECTIONS')", 5).then(function (r) {
        var have = {}; r.forEach(function (x) { have[x.TABLE_NAME] = 1; });
        var todo = [];
        Object.keys(PS_DDL).forEach(function (t) { if (!have[t]) todo = todo.concat(PS_DDL[t]); });
        if (todo.length) toast('Creating the pipeline setup tables in the APEX database…', 'warn');
        return todo.reduce(function (p, ddl) { return p.then(function () { return dbWrite(ddl); }); }, Promise.resolve());
    });
}
function psLoad() {
    PS.state = 'loading'; psRender();
    return psEnsureTables().then(function () {
        return Promise.all([
            dbRead('SELECT server_id, server_name, protocol, host, port, base_path, api_user, api_token, public_key, key_fingerprint, timezone, poll_seconds, max_parallel, ' +
                "is_default, active, status, server_version, TO_CHAR(last_heartbeat, 'YYYY-MM-DD HH24:MI:SS') AS last_heartbeat, " +
                "TO_CHAR(last_test_date, 'YYYY-MM-DD HH24:MI') AS last_test_date, last_test_msg, notes FROM wms_pipe_servers ORDER BY is_default DESC, UPPER(server_name)", 200),
            dbRead('SELECT conn_id, conn_name, conn_type, server_id, host, port, service_name, database_name, tns_alias, tns_descriptor, wallet_path, rest_url, auth_type, ' +
                "username, CASE WHEN password_enc IS NOT NULL THEN 'Y' ELSE 'N' END AS has_password, SUBSTR(password_enc, 1, 40) AS pw_head, default_schema, options_json, active, " +
                "last_test_status, TO_CHAR(last_test_date, 'YYYY-MM-DD HH24:MI') AS last_test_date, last_test_msg, notes FROM wms_pipe_connections ORDER BY UPPER(conn_name)", 500)
        ]);
    }).then(function (res) {
        PS.state = 'ready'; PS.error = null;
        PS.servers = res[0].map(function (r) {
            return { id: r.SERVER_ID, name: r.SERVER_NAME, protocol: r.PROTOCOL || 'http', host: r.HOST, port: r.PORT, basePath: r.BASE_PATH || '/', apiUser: r.API_USER || '', apiToken: r.API_TOKEN || '',
                publicKey: r.PUBLIC_KEY || '', fingerprint: r.KEY_FINGERPRINT || '', timezone: r.TIMEZONE || 'UTC', poll: r.POLL_SECONDS, maxParallel: r.MAX_PARALLEL,
                isDefault: r.IS_DEFAULT === 'Y', active: r.ACTIVE !== 'N', status: r.STATUS, version: r.SERVER_VERSION, heartbeat: r.LAST_HEARTBEAT, testDate: r.LAST_TEST_DATE, testMsg: r.LAST_TEST_MSG, notes: r.NOTES || '' };
        });
        PS.conns = res[1].map(function (r) {
            var opt = {}; try { opt = r.OPTIONS_JSON ? JSON.parse(r.OPTIONS_JSON) : {}; } catch (e) { }
            return { id: r.CONN_ID, name: r.CONN_NAME, type: r.CONN_TYPE, serverId: r.SERVER_ID, host: r.HOST || '', port: r.PORT, service_name: r.SERVICE_NAME || '', database_name: r.DATABASE_NAME || '',
                tns_alias: r.TNS_ALIAS || '', tns_descriptor: r.TNS_DESCRIPTOR || '', wallet_path: r.WALLET_PATH || '', rest_url: r.REST_URL || '', auth_type: r.AUTH_TYPE || '',
                username: r.USERNAME || '', hasPassword: r.HAS_PASSWORD === 'Y', default_schema: r.DEFAULT_SCHEMA || '', options: opt, active: r.ACTIVE !== 'N',
                testStatus: r.LAST_TEST_STATUS, testDate: r.LAST_TEST_DATE, testMsg: r.LAST_TEST_MSG, notes: r.NOTES || '' };
        });
        if (PS.sel && !psFind(PS.sel.kind, PS.sel.id)) PS.sel = null;
        if (!PS.sel) PS.sel = PS.servers.length ? { kind: 'server', id: PS.servers[0].id } : PS.conns.length ? { kind: 'conn', id: PS.conns[0].id } : null;
        psRender();
    }).catch(function (e) { PS.state = 'offline'; PS.error = String(e); psRender(); });
}
function psFind(kind, id) { return (kind === 'server' ? PS.servers : PS.conns).filter(function (x) { return String(x.id) === String(id); })[0]; }
function psDefaultServer() { return PS.servers.filter(function (s) { return s.isDefault && s.active; })[0] || PS.servers.filter(function (s) { return s.active; })[0] || null; }

// ── server calls (through the host relay, HTTP Basic auth) ─────
function psBaseUrl(s) {
    var p = String(s.basePath || '/').trim(); if (p.charAt(0) !== '/') p = '/' + p; p = p.replace(/\/+$/, '');
    return (s.protocol || 'http') + '://' + String(s.host).trim() + ':' + (parseInt(s.port, 10) || 8000) + p;
}
/** → parsed JSON (or { text }) ; rejects on HTTP errors with the server message. */
function psCall(s, path, method, body) {
    var msg = { fullUrl: psBaseUrl(s) + path, username: s.apiUser || undefined, password: s.apiToken || undefined };
    var action = method && method !== 'GET' ? 'executePost' : 'executeGet';
    if (action === 'executePost') { msg.method = method; msg.body = JSON.stringify(body || {}); }
    return fsCall(action, msg).then(function (data) {
        var d = data; if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = { text: data }; } }
        if (d && (d.detail || d.error) && !d.ok && !d.status) throw (typeof d.detail === 'string' ? d.detail : JSON.stringify(d.detail || d.error));
        return d;
    });
}
function psB64(buf) { var b = new Uint8Array(buf), s = ''; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
function psPemDer(pem) {
    var b64 = String(pem).replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), bin = atob(b64), a = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a.buffer;
}
function psFingerprint(pem) {
    return crypto.subtle.digest('SHA-256', psPemDer(pem)).then(function (h) {
        return Array.prototype.map.call(new Uint8Array(h).slice(0, 12), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(':').toUpperCase();
    });
}
/** Encrypts a secret for the pipeline server: 'rsa-oaep-256:<base64>'. */
function psEncrypt(pem, text) {
    if (!window.crypto || !crypto.subtle) return Promise.reject('Encryption is not available in this view');
    return crypto.subtle.importKey('spki', psPemDer(pem), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt'])
        .then(function (key) { return crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, new TextEncoder().encode(text)); })
        .then(function (ct) { return 'rsa-oaep-256:' + psB64(ct); });
}

// ── render ─────────────────────────────────────────────────────
function psRender() {
    var root = $('ps-root'); if (!root) return;
    if (PS.state === 'loading' && !PS.servers.length && !PS.conns.length) { root.innerHTML = '<div class="fs-muted" style="padding:30px;"><span class="fs-spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:middle;"></span> Loading pipeline setups…</div>'; return; }
    if (PS.state === 'offline') { root.innerHTML = '<div class="fs-error-box" style="margin:10px 0;">APEX database not reachable: ' + esc(PS.error) + ' <button class="fs-btn sm" onclick="psLoad()">Retry</button></div>'; return; }
    root.innerHTML = '<div class="ds-layout"><aside class="ds-side"><div class="ds-side-list" id="ps-list"></div></aside><div class="ds-main" id="ps-main"></div></div>';
    psRenderList(); psRenderMain();
}
function psDot(status) { return '<span class="ds-dot ' + (status === 'ONLINE' || status === 'OK' ? '' : status === 'ERROR' || status === 'OFFLINE' ? 'error' : 'idle') + '"></span>'; }
function psConnSummary(c) {
    var t = c.type;
    if (t === 'APEX_REST') return c.rest_url || '—';
    if (t === 'ORACLE_TNS') return (c.username ? c.username + '@' : '') + (c.tns_alias || 'descriptor');
    if (t === 'ORACLE_WALLET') return (c.username ? c.username + '@' : '') + (c.service_name || '');
    return (c.username ? c.username + '@' : '') + (c.host || '?') + (c.port ? ':' + c.port : '') + '/' + (c.service_name || c.database_name || '');
}
function psRenderList() {
    var el = $('ps-list'); if (!el) return;
    var sel = PS.sel || {};
    el.innerHTML =
        '<div class="ds-sec"><i class="fa-solid fa-server"></i> Pipeline servers <span>' + PS.servers.length + '</span><button class="ps-add" onclick="psNew(\'server\')" title="Add pipeline server"><i class="fa-solid fa-plus"></i></button></div>' +
        (PS.servers.map(function (s) {
            return '<div class="ds-item' + (sel.kind === 'server' && String(sel.id) === String(s.id) ? ' sel' : '') + '" onclick="psSelect(\'server\',' + parseInt(s.id, 10) + ')">' + psDot(s.status) +
                '<div class="ds-item-body"><div class="ds-item-name">' + esc(s.name) + '</div><div class="ds-item-sub"><code>' + esc(psBaseUrl(s)) + '</code></div>' +
                '<div class="ds-item-meta"><span>' + esc(s.status || 'not tested') + '</span>' + (s.isDefault ? '<span class="ds-mode">DEFAULT</span>' : '') + (!s.active ? '<span class="ds-mode">INACTIVE</span>' : '') + '</div></div></div>';
        }).join('') || '<div class="ds-none">Add the FastAPI server that will run the pipelines.</div>') +
        '<div class="ds-sec"><i class="fa-solid fa-plug"></i> Connections <span>' + PS.conns.length + '</span><button class="ps-add" onclick="psNew(\'conn\')" title="Add connection"><i class="fa-solid fa-plus"></i></button></div>' +
        (PS.conns.map(function (c) {
            var t = PS_TYPES[c.type] || { label: c.type, icon: 'fa-database', color: '#57504b' };
            return '<div class="ds-item' + (sel.kind === 'conn' && String(sel.id) === String(c.id) ? ' sel' : '') + '" onclick="psSelect(\'conn\',' + parseInt(c.id, 10) + ')">' +
                '<i class="fa-solid ' + t.icon + ' ds-ticon" style="color:' + t.color + '"></i><div class="ds-item-body"><div class="ds-item-name">' + esc(c.name) + '</div>' +
                '<div class="ds-item-sub"><code>' + esc(psConnSummary(c)) + '</code></div>' +
                '<div class="ds-item-meta"><span>' + esc(t.label) + '</span>' + (c.testStatus ? '<span style="color:' + (c.testStatus === 'OK' ? 'var(--fs-green)' : '#b91c1c') + '">' + esc(c.testStatus) + '</span>' : '<span>not tested</span>') + '</div></div></div>';
        }).join('') || '<div class="ds-none">Add the databases pipelines push data to.</div>');
}
function psSelect(kind, id) { PS.sel = { kind: kind, id: id }; psRenderList(); psRenderMain(); }
function psNew(kind) { PS.sel = { kind: kind, id: null }; psRenderList(); psRenderMain(); }
function psRenderMain() {
    var el = $('ps-main'); if (!el) return;
    var sel = PS.sel;
    if (!sel) {
        el.innerHTML = '<div class="ds-empty"><div class="ds-empty-icon"><i class="fa-solid fa-diagram-successor"></i></div><h3>Set up data pipelines</h3>' +
            '<ol><li>Add the <b>pipeline server</b> — the Python FastAPI service that runs pipelines on a schedule (e.g. <code>145.241.119.134</code>, port <code>8000</code>).</li>' +
            '<li><b>Test</b> it: the app fetches the server\'s public key, used to encrypt the database passwords you enter.</li>' +
            '<li>Add the <b>connections</b> pipelines write to — Oracle, APEX REST, SQL Server, MySQL, PostgreSQL.</li></ol>' +
            '<div class="ds-empty-actions"><button class="fs-btn primary" onclick="psNew(\'server\')"><i class="fa-solid fa-server"></i> Add pipeline server</button>' +
            '<button class="fs-btn" onclick="psNew(\'conn\')"><i class="fa-solid fa-plug"></i> Add connection</button></div></div>';
        return;
    }
    if (sel.kind === 'server') psRenderServer(el, sel.id ? psFind('server', sel.id) : null);
    else psRenderConn(el, sel.id ? psFind('conn', sel.id) : null);
}
function psIn(id, label, value, attrs, hint) {
    return '<div class="ps-f"><label for="' + id + '">' + label + (hint ? ' <small>' + hint + '</small>' : '') + '</label><input id="' + id + '" value="' + esc(value == null ? '' : value) + '" ' + (attrs || '') + '></div>';
}

// ── server form ────────────────────────────────────────────────
function psRenderServer(el, s) {
    var n = s || { name: PS.servers.length ? '' : 'Pipeline server', protocol: 'http', host: '145.241.119.134', port: 8000, basePath: '/', apiUser: 'wms', apiToken: '', timezone: 'UTC', poll: 30, maxParallel: 4, isDefault: !PS.servers.length, active: true, notes: '' };
    el.innerHTML = '<div class="fs-card ds-detail"><div class="ds-detail-head"><div><div class="ds-detail-name"><i class="fa-solid fa-server" style="color:var(--fs-red)"></i> ' + (s ? esc(s.name) : 'New pipeline server') + '</div>' +
        '<p class="ds-detail-desc" style="margin:4px 0 0;">The Python FastAPI service that runs the pipelines on their schedules and pushes data to the targets.</p></div>' +
        (s ? '<div class="ds-detail-badges">' + (s.status ? '<span class="ds-st ' + (s.status === 'ONLINE' ? 'ds-st-ok' : 'ds-st-error') + '">' + esc(s.status) + '</span>' : '<span class="ds-st ds-st-running">Not tested</span>') + '</div>' : '') + '</div>' +
        '<div class="ps-grid">' +
        psIn('pv-name', 'Server name', n.name, 'maxlength="100" placeholder="e.g. Pipeline server PROD"') +
        '<div class="ps-f"><label>Protocol</label><select id="pv-proto"><option' + (n.protocol === 'http' ? ' selected' : '') + '>http</option><option' + (n.protocol === 'https' ? ' selected' : '') + '>https</option></select></div>' +
        psIn('pv-host', 'Host / IP address', n.host, 'placeholder="e.g. 145.241.119.134"') +
        psIn('pv-port', 'Port', n.port, 'type="number" min="1" max="65535"') +
        psIn('pv-path', 'Base path', n.basePath, 'placeholder="/"', 'if the API sits behind a prefix') +
        psIn('pv-tz', 'Timezone', n.timezone, 'placeholder="e.g. Asia/Kolkata"', 'schedules run in this zone') +
        psIn('pv-user', 'API user', n.apiUser, 'autocomplete="off"', 'HTTP Basic') +
        '<div class="ps-f"><label for="pv-token">API token <small>HTTP Basic password</small></label><div class="ps-pw"><input id="pv-token" type="password" autocomplete="new-password" value="' + esc(n.apiToken) + '"><button class="fs-icon-btn" onclick="var i=$(\'pv-token\');i.type=i.type===\'password\'?\'text\':\'password\'" title="Show"><i class="fa-regular fa-eye"></i></button></div></div>' +
        psIn('pv-poll', 'Poll every (seconds)', n.poll, 'type="number" min="5"', 'how often it re-reads definitions') +
        psIn('pv-par', 'Max parallel pipelines', n.maxParallel, 'type="number" min="1" max="50"') +
        '</div>' +
        '<div class="ps-checks"><label><input type="checkbox" id="pv-def"' + (n.isDefault ? ' checked' : '') + '> Default server for new pipelines</label>' +
        '<label><input type="checkbox" id="pv-act"' + (n.active ? ' checked' : '') + '> Active</label></div>' +
        '<div class="ps-f"><label for="pv-notes">Notes</label><input id="pv-notes" maxlength="2000" value="' + esc(n.notes) + '"></div>' +
        '<div class="ds-toolbar"><button class="fs-btn primary" onclick="psSaveServer(' + (s ? parseInt(s.id, 10) : 'null') + ')"><i class="fa-solid fa-floppy-disk"></i> Save</button>' +
        (s ? '<button class="fs-btn" id="pv-test" onclick="psTestServer(' + parseInt(s.id, 10) + ')"><i class="fa-solid fa-stethoscope"></i> Test connection</button>' : '<span class="fs-muted" style="font-size:.78rem;">Save first, then test.</span>') +
        '<span style="flex:1"></span>' + (s ? '<button class="fs-icon-btn" title="Delete server" onclick="psDelete(\'server\',' + parseInt(s.id, 10) + ')"><i class="fa-regular fa-trash-can"></i></button>' : '') + '</div>' +
        (s ? '<div class="ps-status">' +
            '<div><span>Server URL</span><b><code>' + esc(psBaseUrl(s)) + '</code></b></div>' +
            '<div><span>Version</span><b>' + esc(s.version || '—') + '</b></div>' +
            '<div><span>Last heartbeat</span><b>' + esc(s.heartbeat || '—') + '</b></div>' +
            '<div><span>Last test</span><b>' + esc(s.testDate || '—') + '</b></div>' +
            '<div class="wide"><span>Encryption key</span><b>' + (s.publicKey ? '<i class="fa-solid fa-lock" style="color:var(--fs-green)"></i> <code>' + esc(s.fingerprint) + '</code>' : '<i class="fa-solid fa-lock-open" style="color:#b45309"></i> not fetched yet — run Test connection') + '</b></div>' +
            (s.testMsg ? '<div class="wide"><span>Test result</span><b class="ps-msg">' + esc(s.testMsg) + '</b></div>' : '') + '</div>' : '') +
        '<details class="ds-src ps-api"><summary><i class="fa-solid fa-book"></i> API the pipeline server provides <span class="fs-muted">· for the FastAPI build</span></summary><pre>' + esc(PS_API_DOC) + '</pre></details>' +
        '</div>';
}
var PS_API_DOC = [
    'All calls use HTTP Basic auth (API user / API token). JSON in and out.',
    '',
    'GET  /health                    → {"status":"ok","version":"1.0.0","time":"…","timezone":"UTC","running":2,"queued":0}',
    'GET  /public-key                → {"public_key":"-----BEGIN PUBLIC KEY-----…"}   RSA 2048+, SPKI PEM',
    'POST /connections/test          {"conn_id":12}  → {"ok":true,"message":"Connected — Oracle 19c","latency_ms":84}',
    'POST /pipelines/{id}/run        {"params":{…},"requested_by":"JAVEED"}  → {"run_id":501,"status":"QUEUED"}',
    'POST /runs/{run_id}/cancel      → {"ok":true,"status":"CANCEL_REQUESTED"}',
    'GET  /runs/{run_id}             → run + task runs + last log lines',
    'POST /pipelines/{id}/preview    {"task_id":7,"limit":20} → first rows of the task source SQL',
    'POST /reload                    → re-read pipeline definitions now',
    '',
    'The server reads WMS_PIPE_SERVERS / _CONNECTIONS / WMS_PIPELINES / WMS_PIPE_TASKS,',
    'writes WMS_PIPE_RUNS / _TASK_RUNS / WMS_PIPE_LOG and last_heartbeat, and decrypts',
    "PASSWORD_ENC ('rsa-oaep-256:<base64>', RSA-OAEP with SHA-256) with its private key.",
    'CONTINUOUS pipelines loop until cancel_requested = \'Y\' on their run (set by the app).'
].join('\n');
function psVal(id) { var e = $(id); return e ? e.value.trim() : ''; }
function psSaveServer(id) {
    var s = { name: psVal('pv-name'), protocol: psVal('pv-proto') || 'http', host: psVal('pv-host'), port: parseInt(psVal('pv-port'), 10) || 8000, basePath: psVal('pv-path') || '/',
        apiUser: psVal('pv-user'), apiToken: $('pv-token').value, timezone: psVal('pv-tz') || 'UTC', poll: parseInt(psVal('pv-poll'), 10) || 30, maxParallel: parseInt(psVal('pv-par'), 10) || 4,
        isDefault: $('pv-def').checked, active: $('pv-act').checked, notes: psVal('pv-notes') };
    if (!s.name) { toast('Give the server a name', 'warn'); return; }
    if (!/^[A-Za-z0-9.\-]+$/.test(s.host)) { toast('Enter a valid host name or IP address', 'warn'); return; }
    if (s.port < 1 || s.port > 65535) { toast('Enter a valid port', 'warn'); return; }
    var user = vlit(appUserName(), 120), yn = function (b) { return b ? "'Y'" : "'N'"; };
    var cols = { server_name: vlit(s.name, 100), protocol: vlit(s.protocol, 5), host: vlit(s.host, 255), port: s.port, base_path: vlit(s.basePath, 200), api_user: vlit(s.apiUser, 100),
        api_token: vlit(s.apiToken, 400), timezone: vlit(s.timezone, 60), poll_seconds: s.poll, max_parallel: s.maxParallel, is_default: yn(s.isDefault), active: yn(s.active), notes: vlit(s.notes, 2000) };
    var p = psEnsureTables();
    if (s.isDefault) p = p.then(function () { return dbWrite("UPDATE wms_pipe_servers SET is_default = 'N' WHERE is_default = 'Y'" + (id ? ' AND server_id <> ' + parseInt(id, 10) : '')); });
    p.then(function () {
        if (id) return dbWrite('UPDATE wms_pipe_servers SET ' + Object.keys(cols).map(function (k) { return k + ' = ' + cols[k]; }).join(', ') + ', updated_by = ' + user + ', updated_date = SYSDATE WHERE server_id = ' + parseInt(id, 10));
        return dbWrite('INSERT INTO wms_pipe_servers (' + Object.keys(cols).join(', ') + ', created_by, created_date) VALUES (' + Object.keys(cols).map(function (k) { return cols[k]; }).join(', ') + ', ' + user + ', SYSDATE)');
    }).then(function () {
        return dbRead('SELECT server_id FROM wms_pipe_servers WHERE UPPER(server_name) = UPPER(' + vlit(s.name, 100) + ')', 1);
    }).then(function (r) {
        toast('Pipeline server saved');
        PS.sel = { kind: 'server', id: r[0] ? r[0].SERVER_ID : id };
        return psLoad();
    }).catch(function (e) { toast('Save failed: ' + (/ORA-00001/.test(String(e)) ? 'a server with this name already exists' : e), 'err'); });
}
function psTestServer(id) {
    var s = psFind('server', id); if (!s) return;
    var btn = $('pv-test'); if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Testing…'; }
    var health, keyPem = null, fp = null, t0 = Date.now();
    psCall(s, '/health').then(function (h) {
        health = h || {};
        return psCall(s, '/public-key').then(function (k) { keyPem = (k && (k.public_key || k.publicKey || k.text)) || null; }, function () { keyPem = null; });
    }).then(function () {
        return keyPem && /BEGIN PUBLIC KEY/.test(keyPem) ? psFingerprint(keyPem).then(function (f) { fp = f; }) : null;
    }).then(function () {
        var changed = s.publicKey && keyPem && s.publicKey.replace(/\s+/g, '') !== keyPem.replace(/\s+/g, '');
        var msg = 'Reached in ' + (Date.now() - t0) + ' ms — ' + (health.status || 'ok') + (health.version ? ', version ' + health.version : '') + (health.timezone ? ', timezone ' + health.timezone : '') +
            (keyPem ? (fp ? '. Encryption key received.' : '. The key is not a PEM public key.') : '. No /public-key — passwords cannot be encrypted yet.');
        return dbWrite("UPDATE wms_pipe_servers SET status = 'ONLINE', server_version = " + vlit(health.version || '', 60) + ', last_test_date = SYSDATE, last_test_msg = ' + vlit(msg, 4000) +
            (fp ? ', public_key = ' + vlit(keyPem, 4000) + ', key_fingerprint = ' + vlit(fp, 100) : '') + ' WHERE server_id = ' + parseInt(id, 10)).then(function () {
                toast(changed ? 'Server reached — its encryption key CHANGED: re-enter the passwords of its connections' : 'Pipeline server is online', changed ? 'warn' : 'ok');
            });
    }).catch(function (e) {
        var msg = 'Not reachable: ' + String(e).slice(0, 300) + ' — check the IP/port, that the FastAPI service is running and the firewall allows port ' + s.port + '.';
        toast('Pipeline server not reachable', 'err');
        return dbWrite("UPDATE wms_pipe_servers SET status = 'OFFLINE', last_test_date = SYSDATE, last_test_msg = " + vlit(msg, 4000) + ' WHERE server_id = ' + parseInt(id, 10));
    }).then(function () { return psLoad(); });
}

// ── connection form ────────────────────────────────────────────
function psRenderConn(el, c) {
    var type = (c && c.type) || (PS.newType || 'ORACLE_EZ');
    var n = c || { name: '', type: type, serverId: (psDefaultServer() || {}).id, host: '', port: PS_TYPES[type].port || '', service_name: '', database_name: '', tns_alias: '', tns_descriptor: '', wallet_path: '', rest_url: '', auth_type: type === 'APEX_REST' ? 'BASIC' : 'PASSWORD', username: '', hasPassword: false, default_schema: '', options: {}, active: true, notes: '' };
    var T = PS_TYPES[type];
    var server = psFind('server', n.serverId) || psDefaultServer();
    var canEncrypt = server && server.publicKey;
    var f = function (k) {
        var def = PS_FIELDS[k], v = n[k];
        if (k === 'port') return psIn('pc-port', def[0], v || T.port || '', 'type="number" min="1" max="65535"');
        if (k === 'tns_descriptor') return '<div class="ps-f wide"><label for="pc-tns_descriptor">' + def[0] + '</label><textarea id="pc-tns_descriptor" class="fs-db-sql" style="min-height:54px;" placeholder="' + esc(def[1]) + '">' + esc(v) + '</textarea></div>';
        if (k === 'auth_type') return '<div class="ps-f"><label>' + def[0] + '</label><select id="pc-auth_type">' + ['NONE', 'BASIC', 'BEARER'].map(function (a) { return '<option' + (n.auth_type === a ? ' selected' : '') + '>' + a + '</option>'; }).join('') + '</select></div>';
        if (k === 'password') {
            return '<div class="ps-f"><label for="pc-password">' + (type === 'APEX_REST' ? 'Password / token' : 'Password') + ' <small>' + (canEncrypt ? '<i class="fa-solid fa-lock"></i> encrypted for ' + esc(server.name) : '') + '</small></label>' +
                '<div class="ps-pw"><input id="pc-password" type="password" autocomplete="new-password" ' + (canEncrypt ? '' : 'disabled ') + 'placeholder="' + (!canEncrypt ? 'test the pipeline server first' : n.hasPassword ? '•••••• saved — leave empty to keep' : '') + '"></div></div>';
        }
        if (k === 'opt_encrypt' || k === 'opt_trust' || k === 'opt_ssl') {
            var key = k.slice(4), on = n.options[key] != null ? !!n.options[key] : k !== 'opt_trust';
            return '<div class="ps-f ps-cb"><label><input type="checkbox" id="pc-' + k + '"' + (on ? ' checked' : '') + '> ' + def[0] + '</label></div>';
        }
        if (k === 'opt_sslmode') return '<div class="ps-f"><label>' + def[0] + '</label><select id="pc-opt_sslmode">' + ['disable', 'prefer', 'require', 'verify-full'].map(function (m) { return '<option' + ((n.options.sslmode || 'prefer') === m ? ' selected' : '') + '>' + m + '</option>'; }).join('') + '</select></div>';
        return psIn('pc-' + k, def[0], v, 'placeholder="' + esc(def[1]) + '"');
    };
    el.innerHTML = '<div class="fs-card ds-detail"><div class="ds-detail-head"><div><div class="ds-detail-name"><i class="fa-solid ' + T.icon + '" style="color:' + T.color + '"></i> ' + (c ? esc(c.name) : 'New connection') + '</div>' +
        '<p class="ds-detail-desc" style="margin:4px 0 0;">A database or API that pipelines write to (or read from). The pipeline server connects to it — not this PC.</p></div>' +
        (c && c.testStatus ? '<div class="ds-detail-badges"><span class="ds-st ' + (c.testStatus === 'OK' ? 'ds-st-ok' : 'ds-st-error') + '">' + esc(c.testStatus) + '</span></div>' : '') + '</div>' +
        '<label class="ps-lab">Type</label><div class="ps-types">' + Object.keys(PS_TYPES).map(function (k) {
            var t = PS_TYPES[k];
            return '<button class="ps-type' + (k === type ? ' on' : '') + '" style="--c:' + t.color + '" ' + (c ? 'disabled title="The type cannot change — create a new connection"' : 'onclick="PS.newType=\'' + k + '\';psRenderMain()"') + '><i class="fa-solid ' + t.icon + '"></i><b>' + t.label + '</b><small>' + t.sub + '</small></button>';
        }).join('') + '</div>' +
        '<div class="ps-grid">' + psIn('pc-name', 'Connection name', n.name, 'maxlength="100" placeholder="e.g. DW Oracle PROD"') +
        '<div class="ps-f"><label>Pipeline server <small>its key encrypts the password</small></label><select id="pc-server" onchange="PS.pendingServer=this.value">' +
        (PS.servers.map(function (sv) { return '<option value="' + sv.id + '"' + (server && String(server.id) === String(sv.id) ? ' selected' : '') + '>' + esc(sv.name) + (sv.publicKey ? '' : ' (not tested)') + '</option>'; }).join('') || '<option value="">— add a pipeline server first —</option>') + '</select></div>' +
        T.fields.map(f).join('') + '</div>' +
        (!canEncrypt ? '<div class="fl-banner stop" style="margin-top:6px;"><i class="fa-solid fa-lock-open"></i><div>Passwords can be entered once a <b>pipeline server has been tested</b>: the app encrypts them with that server\'s public key, so only the server can read them.</div></div>' : '') +
        '<div class="ps-checks"><label><input type="checkbox" id="pc-act"' + (n.active ? ' checked' : '') + '> Active</label></div>' +
        '<div class="ps-f"><label for="pc-notes">Notes</label><input id="pc-notes" maxlength="2000" value="' + esc(n.notes) + '"></div>' +
        '<div class="ds-toolbar"><button class="fs-btn primary" onclick="psSaveConn(' + (c ? parseInt(c.id, 10) : 'null') + ',\'' + type + '\')"><i class="fa-solid fa-floppy-disk"></i> Save</button>' +
        (c ? '<button class="fs-btn" id="pc-test" onclick="psTestConn(' + parseInt(c.id, 10) + ')"><i class="fa-solid fa-stethoscope"></i> Test connection</button>' : '<span class="fs-muted" style="font-size:.78rem;">Save first, then test (the pipeline server connects).</span>') +
        '<span style="flex:1"></span>' + (c ? '<button class="fs-icon-btn" title="Delete connection" onclick="psDelete(\'conn\',' + parseInt(c.id, 10) + ')"><i class="fa-regular fa-trash-can"></i></button>' : '') + '</div>' +
        (c ? '<div class="ps-status"><div class="wide"><span>Connects as</span><b><code>' + esc(psConnSummary(c)) + '</code></b></div>' +
            '<div><span>Password</span><b>' + (c.hasPassword ? '<i class="fa-solid fa-lock" style="color:var(--fs-green)"></i> encrypted' : '—') + '</b></div>' +
            '<div><span>Last test</span><b>' + esc(c.testDate || '—') + '</b></div>' +
            (c.testMsg ? '<div class="wide"><span>Test result</span><b class="ps-msg">' + esc(c.testMsg) + '</b></div>' : '') + '</div>' : '') + '</div>';
}
function psSaveConn(id, type) {
    var T = PS_TYPES[type], old = id ? psFind('conn', id) : null;
    var name = psVal('pc-name'); if (!name) { toast('Give the connection a name', 'warn'); return; }
    var serverId = psVal('pc-server'), server = psFind('server', serverId);
    var g = function (k) { return psVal('pc-' + k); };
    var need = { host: 'Host', service_name: 'Service name', database_name: 'Database', rest_url: 'Base URL' };
    for (var i = 0; i < T.fields.length; i++) { var k = T.fields[i]; if (need[k] && !g(k)) { toast(need[k] + ' is required', 'warn'); return; } }
    if (type === 'ORACLE_TNS' && !g('tns_alias') && !g('tns_descriptor')) { toast('Enter a TNS alias or a descriptor', 'warn'); return; }
    var opts = {};
    ['encrypt', 'trust', 'ssl'].forEach(function (k) { var e = $('pc-opt_' + k); if (e) opts[k] = e.checked; });
    if ($('pc-opt_sslmode')) opts.sslmode = $('pc-opt_sslmode').value;
    var pw = $('pc-password') ? $('pc-password').value : '';
    var serverChanged = old && old.hasPassword && String(old.serverId) !== String(serverId);
    if (serverChanged && !pw) { toast('The pipeline server changed — re-enter the password so it is encrypted for the new server', 'warn'); return; }
    var enc = pw ? (server && server.publicKey ? psEncrypt(server.publicKey, pw) : Promise.reject('Test the pipeline server first — its key encrypts the password')) : Promise.resolve(null);
    enc.then(function (cipher) {
        var user = vlit(appUserName(), 120);
        var cols = { conn_name: vlit(name, 100), conn_type: vlit(type, 20), server_id: serverId ? parseInt(serverId, 10) : 'NULL',
            host: vlit(g('host'), 255), port: parseInt(g('port'), 10) || 'NULL', service_name: vlit(g('service_name'), 200), database_name: vlit(g('database_name'), 200),
            tns_alias: vlit(g('tns_alias'), 200), tns_descriptor: vlit(g('tns_descriptor'), 4000), wallet_path: vlit(g('wallet_path'), 500), rest_url: vlit(g('rest_url'), 1000),
            auth_type: vlit(type === 'APEX_REST' ? g('auth_type') : 'PASSWORD', 20), username: vlit(g('username'), 200), default_schema: vlit(g('default_schema'), 128),
            options_json: vlit(JSON.stringify(opts), 4000), active: $('pc-act').checked ? "'Y'" : "'N'", notes: vlit(psVal('pc-notes'), 2000) };
        if (cipher) cols.password_enc = vlit(cipher, 4000);
        return psEnsureTables().then(function () {
            if (id) return dbWrite('UPDATE wms_pipe_connections SET ' + Object.keys(cols).map(function (k) { return k + ' = ' + cols[k]; }).join(', ') +
                (cipher ? ", last_test_status = NULL" : '') + ', updated_by = ' + user + ', updated_date = SYSDATE WHERE conn_id = ' + parseInt(id, 10));
            return dbWrite('INSERT INTO wms_pipe_connections (' + Object.keys(cols).join(', ') + ', created_by, created_date) VALUES (' + Object.keys(cols).map(function (k) { return cols[k]; }).join(', ') + ', ' + user + ', SYSDATE)');
        });
    }).then(function () {
        return dbRead('SELECT conn_id FROM wms_pipe_connections WHERE UPPER(conn_name) = UPPER(' + vlit(name, 100) + ')', 1);
    }).then(function (r) {
        toast(pw ? 'Connection saved — password encrypted for the pipeline server' : 'Connection saved');
        PS.newType = null; PS.sel = { kind: 'conn', id: r[0] ? r[0].CONN_ID : id };
        return psLoad();
    }).catch(function (e) { toast('Save failed: ' + (/ORA-00001/.test(String(e)) ? 'a connection with this name already exists' : e), 'err'); });
}
function psTestConn(id) {
    var c = psFind('conn', id); if (!c) return;
    var s = psFind('server', c.serverId) || psDefaultServer();
    if (!s) { toast('Add and test a pipeline server first — it runs the connection test', 'warn'); return; }
    var btn = $('pc-test'); if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Testing on ' + esc(s.name) + '…'; }
    psCall(s, '/connections/test', 'POST', { conn_id: c.id }).then(function (r) {
        var ok = !!(r && (r.ok || r.status === 'ok'));
        var msg = (r && (r.message || r.detail || r.text)) || (ok ? 'Connected' : 'Failed');
        if (r && r.latency_ms != null) msg += ' (' + r.latency_ms + ' ms)';
        return { ok: ok, msg: msg };
    }, function (e) { return { ok: false, msg: 'Pipeline server not reachable or refused: ' + String(e).slice(0, 300) }; }).then(function (res) {
        toast(res.ok ? 'Connection OK' : 'Connection failed — see the test result', res.ok ? 'ok' : 'err');
        return dbWrite('UPDATE wms_pipe_connections SET last_test_status = ' + (res.ok ? "'OK'" : "'ERROR'") + ', last_test_date = SYSDATE, last_test_msg = ' + vlit(res.msg, 4000) + ' WHERE conn_id = ' + parseInt(id, 10));
    }).then(function () { return psLoad(); });
}
function psDelete(kind, id) {
    var x = psFind(kind, id); if (!x) return;
    var check = kind === 'conn'
        ? dbRead('SELECT COUNT(*) AS n FROM wms_pipe_tasks WHERE target_conn_id = ' + parseInt(id, 10) + ' OR source_conn_id = ' + parseInt(id, 10), 1).catch(function () { return [{ N: 0 }]; })
        : dbRead('SELECT COUNT(*) AS n FROM wms_pipe_connections WHERE server_id = ' + parseInt(id, 10), 1).catch(function () { return [{ N: 0 }]; });
    check.then(function (r) {
        var used = +(r[0] && r[0].N) || 0;
        if (used) { toast('Still used by ' + used + (kind === 'conn' ? ' pipeline task(s)' : ' connection(s)') + ' — change those first', 'warn'); return; }
        confirmModal('Delete "' + x.name + '"?', kind === 'conn' ? 'Removes the connection and its encrypted password.' : 'Removes the pipeline server definition. The server itself is not touched.', function () {
            dbWrite('DELETE FROM ' + (kind === 'conn' ? 'wms_pipe_connections WHERE conn_id = ' : 'wms_pipe_servers WHERE server_id = ') + parseInt(id, 10))
                .then(function () { toast('Deleted'); PS.sel = null; return psLoad(); })
                .catch(function (e) { toast('Delete failed: ' + e, 'err'); });
        });
    });
}

// ── Setups tab switch: checklist ↔ data pipeline setups ─────────
function suSeg(seg) {
    lsSet('fusionSql.setupSeg', seg);
    document.querySelectorAll('#su-seg button').forEach(function (b) { b.classList.toggle('on', b.dataset.seg === seg); });
    $('su-check').style.display = seg === 'check' ? '' : 'none';
    $('su-actions').style.display = seg === 'check' ? '' : 'none';
    $('ps-root').style.display = seg === 'pipe' ? '' : 'none';
    $('su-title').innerHTML = seg === 'pipe' ? '<i class="fa-solid fa-diagram-successor"></i> Data pipeline setups' : '<i class="fa-solid fa-list-check"></i> Fusion Setups';
    $('su-desc').innerHTML = seg === 'pipe' ? 'The pipeline server (Python FastAPI) that runs scheduled pipelines, and the target databases it pushes data to. Passwords are encrypted with the server\'s key — only the server can read them.'
        : 'Module-wise setup checklist. Each task\'s check SQL runs on the pod like the SQL Builder — <b>Done</b> when it returns the configured records; click <b>Data</b> to drill into them.';
    if (seg === 'pipe' && PS.state !== 'ready') psLoad();
}
