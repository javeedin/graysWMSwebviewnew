/* User access to modules (window.WMSACCESS) — which Home tiles a login sees.
 * Shared by Home (shows / hides the tiles at login), the Admin page (User Access tab) and pages that guard themselves.
 * Everything lives in APEX through the ai/executequery | executewrite gateway (apex_sql/101_user_access.sql — the page
 * creates the tables on first use):
 *   WMS_APP_MODULES          the modules (one per Home tile), seeded from MODULES below and kept in step on every ensure()
 *   WMS_USER_MODULE_ACCESS   one row per app login × module: active Y / N, granted by / at, revoked by / at, note
 *   WMS_USER_ACCESS_LOG      every grant / revoke: who, when, from which PC — the audit trail
 * The login JAVEED gets every module (also modules added later) unless one was revoked from him on purpose.
 * Logins are kept upper-case. Reads never contain the gateway's refused words (UPDATE / DELETE / DBMS_ / UTL_). */
(function (root) {
    'use strict';
    var A = root.WMSACCESS = {};
    A.GW = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/WAREHOUSEMANAGEMENT/ai';
    A.SUPER = ['JAVEED'];   // always given every module (rows written for him, so the audit shows it)

    // ── the modules = the Home tiles (code = folder, + page / #part when a folder has several tiles) ──
    A.MODULES = [
        ['wms', 'Warehouse Management', 'Warehouse & Orders', '../wms/index.html', 'Trip management, print jobs, printers'],
        ['wms2', 'WMS 2.0', 'Warehouse & Orders', '../wms2/index.html', 'Control tower for a trip date'],
        ['wms2-tomorrow', 'Tomorrow Check', 'Warehouse & Orders', '../wms2/index.html#tomorrow', "Tomorrow's failures, fixed tonight"],
        ['om', 'Order Management', 'Warehouse & Orders', '../om/index.html', 'Order pad, approvals, Fusion orders'],
        ['Inventory', 'Inventory', 'Warehouse & Orders', '../Inventory/index.html', 'Items, on-hand, transactions, receiving'],
        ['fieldapps', 'Field Apps', 'Warehouse & Orders', '../fieldapps/index.html', 'Apps and the POS for the pickers\' phones'],
        ['crm', 'Customer CRM', 'Warehouse & Orders', '../crm/index.html', 'Customers, tickets, calls, opportunities'],
        ['saleslens', 'Sales Lens', 'Warehouse & Orders', '../saleslens/index.html', 'Missed sales, causes, lost margin, simulations'],
        ['finance', 'Finance Lens', 'Finance', '../finance/index.html', 'Statements, KPIs, board packs'],
        ['debtors', 'Fusion Debtors Control', 'Finance', '../debtors/index.html', 'Customer statements and follow-ups'],
        ['fscm-om', 'Fusion Order Management', 'Oracle Fusion', '../fscm/om.html', 'Order Hub, POS order, customers'],
        ['fscm-shipping', 'Fusion Shipping', 'Oracle Fusion', '../fscm/shipping.html', 'Pick release, confirm, ship confirm'],
        ['fscm-purchasing', 'Fusion Purchasing', 'Oracle Fusion', '../fscm/purchasing.html', 'POs, receipts, suppliers'],
        ['fscm-inventory', 'Fusion Inventory', 'Oracle Fusion', '../fscm/inventory.html', 'Item master, on-hand, transfers'],
        ['fscm-costing', 'Fusion Costing', 'Oracle Fusion', '../fscm/costing.html', 'Item and receipt costs'],
        ['fscm-setup', 'Fusion Setup & Diagnostics', 'Oracle Fusion', '../fscm/setup.html', 'Business units, setup explorer, UAT'],
        ['fusionsql', 'Fusion SQL', 'Oracle Fusion', '../fusionsql/index.html', 'Read-only SQL on Oracle Fusion'],
        ['bip', 'Oracle BIP Reporting', 'Oracle Fusion', '../bip/index.html', 'BI Publisher catalog, runs, dashboards'],
        ['dataload', 'Data Loading', 'Oracle Fusion', '../dataload/index.html', 'FBDI templates, REST loads'],
        ['fusionmodel', 'Fusion Model', 'Oracle Fusion', '../fusionmodel/index.html', 'DuckDB dataset, dashboards'],
        ['powerbi', 'Power BI', 'Oracle Fusion', '../powerbi/index.html', 'Power BI reports in the app'],
        ['aiagent', 'AI Agent', 'AI', '../aiagent/index.html', 'AI specialists'],
        ['aihub', 'AI Hub', 'AI', '../aihub/index.html', 'Model gateway, evals'],
        ['aianalysis', 'AI Digital Employee', 'AI', '../aianalysis/index.html', 'Ask and operate the WMS in plain English'],
        ['teachme', 'Teach Me', 'AI', '../teachme/index.html', 'Lessons the app repeats'],
        ['rag', 'AI Knowledge Base', 'AI', '../rag/index.html', 'RAG over WMS data'],
        ['agentflow', 'Agent Flow', 'AI', '../agentflow/index.html', 'Agentic flows on a canvas'],
        ['internetsearch', 'Internet Search', 'AI', '../internetsearch/index.html', 'Web search page'],
        ['dllexplorer', 'DLL Explorer', 'Tools', '../dllexplorer/index.html', 'Read a .dll / .exe'],
        ['formsdesigner', 'Forms Designer', 'Tools', '../formsdesigner/index.html', 'Master-detail forms'],
        ['admin', 'Admin', 'Tools', '../admin/index.html', 'Create ZIP file, user access']
    ].map(function (m, i) { return { code: m[0], title: m[1], group: m[2], href: m[3], desc: m[4], sort: i + 1 }; });

    /** a tile's href → its module code: ../fscm/om.html → fscm-om, ../wms2/index.html#tomorrow → wms2-tomorrow */
    A.codeOf = function (href) {
        var m = /\.\.\/([^\/]+)\/([^#?]*)(?:[?][^#]*)?(?:#(.*))?$/.exec(String(href || ''));
        if (!m) return '';
        var page = m[2].replace(/\.html?$/i, ''), code = m[1];
        if (page && page.toLowerCase() !== 'index') code += '-' + page;
        if (m[3]) code += '-' + m[3];
        return code;
    };
    A.key = function (u) { return String(u || '').trim().toUpperCase(); };
    A.me = function () { try { return A.key(localStorage.getItem('username') || localStorage.getItem('wms_user') || ''); } catch (e) { return ''; } };
    A.isSuper = function (u) { return A.SUPER.indexOf(A.key(u)) >= 0; };

    // ── this PC's copy of the last answer (so Home hides tiles at once, before APEX answers) ──
    A.cached = function (u) { try { var v = localStorage.getItem('access.mods.' + A.key(u)); return v ? JSON.parse(v) : null; } catch (e) { return null; } };
    A.keep = function (u, x) { try { localStorage.setItem('access.mods.' + A.key(u), JSON.stringify(x)); } catch (e) { } };

    // ── host bridge (own request ids) ──
    var pending = {};
    A.hasHost = function () { return !!(root.chrome && root.chrome.webview); };
    function post(url, body, ms) {
        return new Promise(function (resolve, reject) {
            if (!A.hasHost()) { reject(new Error('Open this page inside the Gray\'s WMS app.')); return; }
            var id = 'acc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
            pending[id] = { resolve: resolve, reject: reject };
            root.chrome.webview.postMessage({ action: 'executePost', requestId: id, fullUrl: url, body: JSON.stringify(body) });
            setTimeout(function () { if (pending[id]) { delete pending[id]; reject(new Error('The database did not answer in time')); } }, ms || 30000);
        });
    }
    if (A.hasHost()) root.chrome.webview.addEventListener('message', function (ev) {
        var r = ev.data; if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { return; } }
        if (!r || !r.requestId || !pending[r.requestId]) return;
        var cb = pending[r.requestId]; delete pending[r.requestId];
        if (r.action === 'error') { cb.reject(new Error((r.data && r.data.message) || r.message || 'Host error')); return; }
        var text = r.action === 'restResponse' ? r.data : (typeof r.data === 'string' ? r.data : JSON.stringify(r.data));
        var j = null; try { j = JSON.parse(text); } catch (e) { }
        if (!j) { cb.reject(new Error('Unexpected answer from the database API' + (r.statusCode ? ' (HTTP ' + r.statusCode + ')' : ''))); return; }
        if (j.success === false) { cb.reject(new Error(j.error || j.message || 'Database API error')); return; }
        cb.resolve(j);
    });
    function gw(op, payload, ms) { return post(A.GW + '/' + op, Object.assign({ appUser: A.me() || 'ADMIN' }, payload), ms); }
    A.rows = function (sql, max) {
        return gw('executequery', { sql: sql, maxRows: Math.min(max || 500, 1000) }).then(function (d) {
            var cols = (d.columns || []).map(function (c) { return String(c.name || c).toUpperCase(); });
            return (d.rows || []).map(function (r) {
                if (!Array.isArray(r)) { var o = {}; Object.keys(r).forEach(function (k) { o[k.toUpperCase()] = r[k]; }); return o; }
                var x = {}; cols.forEach(function (c, i) { x[c] = r[i]; }); return x;
            });
        });
    };
    A.write = function (sql) { return gw('executewrite', { sql: sql }, 60000); };
    A.rowsAll = function (sql, max) {
        var out = [], page = 1000, limit = max || 20000;
        function next(off) { return A.rows(sql + ' OFFSET ' + off + ' ROWS FETCH NEXT ' + page + ' ROWS ONLY', page).then(function (r) { out = out.concat(r); return r.length < page || out.length >= limit ? out : next(off + page); }); }
        return next(0);
    };
    var lit = A.lit = function (s, max) { if (s == null || s === '') return 'NULL'; s = String(s); if (max) s = s.slice(0, max); return "'" + s.replace(/'/g, "''") + "'"; };
    var TS = "'YYYY-MM-DD HH24:MI'";

    // ── tables ──
    A.DDL = {
        WMS_APP_MODULES: "CREATE TABLE wms_app_modules (module_code VARCHAR2(60) PRIMARY KEY, title VARCHAR2(200), group_name VARCHAR2(60), href VARCHAR2(300), description VARCHAR2(1000), sort_n NUMBER, active VARCHAR2(1) DEFAULT 'Y', created_at DATE DEFAULT SYSDATE, changed_date DATE)",
        WMS_USER_MODULE_ACCESS: "CREATE TABLE wms_user_module_access (app_user VARCHAR2(100) NOT NULL, module_code VARCHAR2(60) NOT NULL, active VARCHAR2(1) DEFAULT 'Y', granted_by VARCHAR2(100), granted_at DATE DEFAULT SYSDATE, revoked_by VARCHAR2(100), revoked_at DATE, note VARCHAR2(400), changed_by VARCHAR2(100), changed_date DATE DEFAULT SYSDATE, CONSTRAINT wms_user_module_access_pk PRIMARY KEY (app_user, module_code))",
        WMS_USER_ACCESS_LOG: "CREATE TABLE wms_user_access_log (log_id VARCHAR2(40) PRIMARY KEY, app_user VARCHAR2(100), module_code VARCHAR2(60), action VARCHAR2(20), by_user VARCHAR2(100), machine VARCHAR2(100), note VARCHAR2(400), logged_at DATE DEFAULT SYSDATE)"
    };
    A.INDEXES = ['CREATE INDEX wms_user_access_log_u ON wms_user_access_log (app_user, logged_at)'];
    var ensured = null;
    /** tables exist (created when missing), the modules list matches MODULES, JAVEED holds every module → {created} */
    A.ensure = function () {
        if (ensured) return ensured;
        var names = Object.keys(A.DDL);
        ensured = A.rows("SELECT table_name AS T FROM user_tables WHERE table_name IN ('" + names.join("','") + "')", 10).then(function (r) {
            var have = {}; r.forEach(function (x) { have[String(x.T).toUpperCase()] = 1; });
            var missing = names.filter(function (t) { return !have[t]; });
            return missing.reduce(function (p, t) { return p.then(function () { return A.write(A.DDL[t]).catch(function (e) { if (!/ORA-00955/.test(e.message)) throw e; }); }); }, Promise.resolve())
                .then(function () { if (missing.indexOf('WMS_USER_ACCESS_LOG') >= 0) return A.INDEXES.reduce(function (p, d) { return p.then(function () { return A.write(d).catch(function () { }); }); }, Promise.resolve()); })
                .then(function () { return A.syncModules(); })
                .then(function () { return A.seedSuper(); })
                .then(function () { return { created: missing }; });
        }).catch(function (e) { ensured = null; throw e; });
        return ensured;
    };
    /** WMS_APP_MODULES = MODULES: new ones added, titles / groups / links kept in step (a module no longer listed stays, marked inactive) */
    A.syncModules = function () {
        var sel = A.MODULES.map(function (m) {
            return 'SELECT ' + [lit(m.code) + ' AS module_code', lit(m.title) + ' AS title', lit(m.group) + ' AS group_name', lit(m.href) + ' AS href', lit(m.desc) + ' AS description', m.sort + ' AS sort_n'].join(', ') + ' FROM dual';
        }).join(' UNION ALL ');
        return A.write('MERGE INTO wms_app_modules t USING (' + sel + ') s ON (t.module_code = s.module_code) ' +
            "WHEN MATCHED THEN UPDATE SET title = s.title, group_name = s.group_name, href = s.href, description = s.description, sort_n = s.sort_n, active = 'Y', changed_date = SYSDATE " +
            "WHEN NOT MATCHED THEN INSERT (module_code, title, group_name, href, description, sort_n, active, created_at) VALUES (s.module_code, s.title, s.group_name, s.href, s.description, s.sort_n, 'Y', SYSDATE)")
            .then(function () { return A.write("UPDATE wms_app_modules SET active = 'N', changed_date = SYSDATE WHERE active = 'Y' AND module_code NOT IN (" + A.MODULES.map(function (m) { return lit(m.code); }).join(', ') + ')'); });
    };
    /** JAVEED: a row for every module he has no row for (a module revoked from him on purpose stays revoked) + the audit rows */
    A.seedSuper = function () {
        return A.SUPER.reduce(function (p, u) {
            return p.then(function () {
                return A.rows('SELECT module_code AS M FROM wms_user_module_access WHERE app_user = ' + lit(u), 1000).then(function (r) {
                    var have = {}; r.forEach(function (x) { have[x.M] = 1; });
                    var add = A.MODULES.filter(function (m) { return !have[m.code]; }).map(function (m) { return m.code; });
                    if (!add.length) return;
                    return A.write('INSERT INTO wms_user_module_access (app_user, module_code, active, granted_by, granted_at, note, changed_by, changed_date) ' +
                        add.map(function (c) { return 'SELECT ' + lit(u) + ', ' + lit(c) + ", 'Y', 'SYSTEM', SYSDATE, 'Every module (administrator)', 'SYSTEM', SYSDATE FROM dual"; }).join(' UNION ALL '))
                        .then(function () { return log(u, add, 'GRANT', 'SYSTEM', 'Every module (administrator)'); });
                });
            });
        }, Promise.resolve());
    };
    function uid() { return 'AL' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 8).toUpperCase(); }
    function machine() { try { return localStorage.getItem('machineName') || ''; } catch (e) { return ''; } }
    function log(user, codes, action, by, note) {
        if (!codes.length) return Promise.resolve();
        return A.write('INSERT INTO wms_user_access_log (log_id, app_user, module_code, action, by_user, machine, note, logged_at) ' +
            codes.map(function (c) { return 'SELECT ' + [lit(uid()), lit(user, 100), lit(c, 60), lit(action, 20), lit(by, 100), lit(machine(), 100), lit(note, 400), 'SYSDATE'].join(', ') + ' FROM dual'; }).join(' UNION ALL '));
    }

    // ── reads ──
    /** the modules a login may open → {state: 'ok' | 'notable' | 'error', modules: [codes], at, error}; kept on this PC */
    A.forUser = function (u) {
        u = A.key(u);
        if (!u) return Promise.resolve({ state: 'nouser', modules: [] });
        return A.rows("SELECT module_code AS M FROM wms_user_module_access WHERE app_user = " + lit(u) + " AND active = 'Y'", 1000).then(function (r) {
            var x = { state: 'ok', modules: r.map(function (z) { return z.M; }).sort(), at: new Date().toISOString() };
            A.keep(u, x); return x;
        }, function (e) {
            if (/ORA-00942/.test(e.message)) return { state: 'notable', modules: [] };
            return { state: 'error', modules: [], error: e.message };
        });
    };
    A.modules = function () { return A.rows("SELECT module_code AS CODE, title AS TITLE, group_name AS GRP, href AS HREF, description AS DESCR, sort_n AS SORT_N, active AS ACTIVE FROM wms_app_modules ORDER BY sort_n, module_code", 500); };
    /** every access row (active and revoked) */
    A.access = function () {
        return A.rowsAll('SELECT app_user AS APP_USER, module_code AS CODE, active AS ACTIVE, granted_by AS GRANTED_BY, TO_CHAR(granted_at, ' + TS + ') AS GRANTED_AT, revoked_by AS REVOKED_BY, TO_CHAR(revoked_at, ' + TS + ') AS REVOKED_AT, note AS NOTE ' +
            'FROM wms_user_module_access ORDER BY app_user, module_code', 50000);
    };
    A.history = function (u, n) {
        return A.rows('SELECT log_id AS ID, app_user AS APP_USER, module_code AS CODE, action AS ACTION, by_user AS BY_USER, machine AS MACHINE, note AS NOTE, TO_CHAR(logged_at, ' + TS + ') AS AT FROM wms_user_access_log' +
            (u ? ' WHERE app_user = ' + lit(A.key(u)) : '') + ' ORDER BY logged_at DESC, log_id DESC FETCH FIRST ' + (n || 300) + ' ROWS ONLY', 1000);
    };

    /** the app's logins: GR_MOBILE_USER (the mobile app's users, what the admin searches) + the table the /login handler reads
     *  (else a table with a username + password column) — never a password / secret column */
    var SECRET = /PASS|PWD|SECRET|TOKEN|HASH|SALT|PIN$|OTP/;
    var USER_COLS = ['USERNAME', 'USER_NAME', 'LOGIN_NAME', 'LOGIN_ID', 'LOGIN', 'USER_ID', 'USERID'];
    var NAME_COLS = ['FULL_NAME', 'DISPLAY_NAME', 'EMPLOYEE_NAME', 'PICKER_NAME', 'NAME', 'FIRST_NAME'];
    var TYPE_COLS = ['USER_TYPE', 'USERTYPE', 'USER_ROLE', 'ROLE', 'USER_CATEGORY', 'DEPARTMENT', 'TYPE'];
    var MOBILE = /^GR_MOBILE_USERS?$/;
    function userColOf(cols) {
        var names = cols.map(function (c) { return c.C; });
        return USER_COLS.filter(function (c) { return names.indexOf(c) >= 0; })[0] ||
            names.filter(function (c) { return /USER|LOGIN/.test(c) && !SECRET.test(c) && !/TYPE|ROLE|_ID$|^ID$|DATE|_BY$/.test(c); })[0] || '';
    }
    /** one table → [{user, name, type, active, src, row}] (DISTINCT of its non-secret, non-LOB columns) */
    function readLogins(table, userCol) {
        return A.rows("SELECT column_name AS C, data_type AS DT FROM user_tab_columns WHERE table_name = " + lit(table) + ' ORDER BY column_id', 300).then(function (cols) {
            userCol = userCol || userColOf(cols);
            if (!userCol) return [];
            var pick = cols.filter(function (c) { return !SECRET.test(c.C) && !/LOB|RAW|LONG|XML|BLOB/.test(c.DT); }).map(function (c) { return c.C; }).slice(0, 25);
            if (pick.indexOf(userCol) < 0) pick.unshift(userCol);
            return A.rowsAll('SELECT DISTINCT ' + pick.join(', ') + ' FROM ' + table + ' ORDER BY ' + userCol, 5000).then(function (rows) {
                var by = {}, out = [];
                rows.forEach(function (r) {
                    var u = A.key(r[userCol]); if (!u || by[u]) return;
                    var name = NAME_COLS.map(function (c) { return r[c]; }).filter(Boolean)[0] || '';
                    var type = TYPE_COLS.map(function (c) { return r[c]; }).filter(Boolean)[0] || '';
                    var st = String(r.ACTIVE || r.STATUS || r.IS_ACTIVE || r.ENABLED || r.ACTIVE_FLAG || '').toUpperCase();
                    by[u] = { user: u, name: String(name), type: String(type).toUpperCase(), active: !(st === 'N' || st === 'NO' || st === '0' || st === 'INACTIVE' || st === 'DISABLED'), src: table, row: r };
                    out.push(by[u]);
                });
                return out;
            });
        });
    }
    A.logins = function () {
        var handlerSql = "SELECT TO_CHAR(SUBSTR(h.source, 1, 3000)) AS SRC FROM user_ords_handlers h JOIN user_ords_templates t ON t.id = h.template_id WHERE LOWER(t.uri_template) LIKE 'login%'";
        var colsSql = "SELECT table_name AS T, column_name AS C, data_type AS DT FROM user_tab_columns WHERE column_name IN (" + USER_COLS.concat(['PASSWORD', 'PASSWD', 'PWD', 'USER_PASSWORD']).map(function (c) { return lit(c); }).join(', ') + ')' +
            " OR table_name IN ('GR_MOBILE_USER', 'GR_MOBILE_USERS')";
        return Promise.all([A.rows(handlerSql, 10).catch(function () { return []; }), A.rows(colsSql, 2000)]).then(function (res) {
            var fromHandler = {}; res[0].forEach(function (r) { var m, re = /\b(?:FROM|JOIN)\s+("?[A-Za-z0-9_$#]+"?)/gi, src = String(r.SRC || ''); while ((m = re.exec(src))) fromHandler[m[1].replace(/"/g, '').toUpperCase()] = 1; });
            var tables = {}; res[1].forEach(function (r) { (tables[r.T] = tables[r.T] || []).push(r.C); });
            var mobile = Object.keys(tables).filter(function (t) { return MOBILE.test(t); }).sort()[0] || '';
            var best = null, bestScore = 0;
            Object.keys(tables).forEach(function (t) {
                var cols = tables[t], u = USER_COLS.filter(function (c) { return cols.indexOf(c) >= 0; })[0];
                if (!u || MOBILE.test(t)) return;
                var score = (fromHandler[t] ? 20 : 0) + (cols.some(function (c) { return /PASS|PWD/.test(c); }) ? 5 : 0) + (/USER/.test(t) ? 2 : 0) - (/LOG$|_LOG|HIST|AUDIT|ACCESS|_V$/.test(t) ? 10 : 0);
                if (score > bestScore) { bestScore = score; best = { table: t, userCol: u }; }
            });
            var srcs = [];
            if (mobile) srcs.push({ table: mobile });
            if (best) srcs.push(best);
            return Promise.all(srcs.map(function (s) {
                return readLogins(s.table, s.userCol).then(function (u) { return { table: s.table, users: u }; }, function (e) { return { table: s.table, users: [], error: e.message }; });
            })).then(function (got) {
                var by = {};
                got.forEach(function (g) {        // GR_MOBILE_USER first: its row wins, the other table only adds its name
                    g.users.forEach(function (u) {
                        var x = by[u.user];
                        if (!x) { by[u.user] = u; u.srcs = [u.src]; return; }
                        if (x.srcs.indexOf(u.src) < 0) x.srcs.push(u.src);
                        if (!x.name && u.name) x.name = u.name;
                        if (!x.type && u.type) x.type = u.type;
                    });
                });
                return {
                    table: got.map(function (g) { return g.table; }).join(' + '),
                    tables: got.map(function (g) { return { table: g.table, n: g.users.length, error: g.error || '' }; }),
                    users: Object.keys(by).sort().map(function (k) { return by[k]; })
                };
            });
        });
    };

    // ── writes (only an Admin-module user may change access) ──
    /** give modules: MERGE (a revoked row is made active again with a new grant date) + one log row per module */
    A.grant = function (user, codes, by, note) {
        user = A.key(user); codes = (codes || []).filter(Boolean); if (!user || !codes.length) return Promise.resolve(0);
        by = A.key(by || A.me());
        var sel = codes.map(function (c) { return 'SELECT ' + lit(user, 100) + ' AS app_user, ' + lit(c, 60) + ' AS module_code FROM dual'; }).join(' UNION ALL ');
        return A.write('MERGE INTO wms_user_module_access t USING (' + sel + ') s ON (t.app_user = s.app_user AND t.module_code = s.module_code) ' +
            "WHEN MATCHED THEN UPDATE SET active = 'Y', granted_by = " + lit(by, 100) + ', granted_at = SYSDATE, revoked_by = NULL, revoked_at = NULL, note = ' + lit(note, 400) + ', changed_by = ' + lit(by, 100) + ", changed_date = SYSDATE WHERE t.active <> 'Y' " +
            "WHEN NOT MATCHED THEN INSERT (app_user, module_code, active, granted_by, granted_at, note, changed_by, changed_date) VALUES (s.app_user, s.module_code, 'Y', " + lit(by, 100) + ', SYSDATE, ' + lit(note, 400) + ', ' + lit(by, 100) + ', SYSDATE)')
            .then(function () { return log(user, codes, 'GRANT', by, note); }).then(function () { return codes.length; });
    };
    /** take modules away: the row stays (active N, revoked by / at) so the audit keeps when it was given and taken */
    A.revoke = function (user, codes, by, note) {
        user = A.key(user); codes = (codes || []).filter(Boolean); if (!user || !codes.length) return Promise.resolve(0);
        by = A.key(by || A.me());
        return A.write("UPDATE wms_user_module_access SET active = 'N', revoked_by = " + lit(by, 100) + ', revoked_at = SYSDATE, note = ' + lit(note, 400) + ', changed_by = ' + lit(by, 100) + ', changed_date = SYSDATE ' +
            'WHERE app_user = ' + lit(user, 100) + " AND active = 'Y' AND module_code IN (" + codes.map(function (c) { return lit(c, 60); }).join(', ') + ')')
            .then(function () { return log(user, codes, 'REVOKE', by, note); }).then(function () { return codes.length; });
    };
    /** remove a login's rows completely (the log keeps the history) */
    A.removeUser = function (user, by) {
        user = A.key(user); by = A.key(by || A.me());
        return A.rows('SELECT module_code AS M FROM wms_user_module_access WHERE app_user = ' + lit(user, 100), 1000).then(function (r) {
            return A.write('DELETE FROM wms_user_module_access WHERE app_user = ' + lit(user, 100)).then(function () { return log(user, r.map(function (x) { return x.M; }), 'REMOVE', by, 'Login removed from user access'); });
        });
    };
})(window);
