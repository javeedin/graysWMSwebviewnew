/* Fusion Debtors Control · host bridge + APEX layer (window.DCS).
 * The host (classes/Form1_DebtorsHandlers.cs) runs the BI Publisher reports and sends the e-mails; Fusion SQL goes through the
 * Fusion SQL runner (fusionSqlExecute). Everything that is recorded lives in APEX through the ai/executequery | executewrite
 * gateway (apex_sql/99_debtors_control.sql — the tables are created here on first use):
 *   WMS_DC_SETTINGS   business units, report / SQL sources, e-mail templates (JSON per key)
 *   WMS_DC_CUSTOMERS  the customer card: statement e-mail / cc, delivery, collector, tags, notes, hold
 *   WMS_DC_RUNS       one row per statement run
 *   WMS_DC_STMTS      one row per statement: who, to whom, when, how, the file's SHA-256, status, opened / read / bounced,
 *                     the customer's answer (agreed / disputed + comment)
 *   WMS_DC_ACTIVITY   the CRM timeline: notes, calls, e-mails, visits, promises to pay, disputes, follow-ups
 * Reads never contain the gateway's refused words (UPDATE / DELETE / DBMS_ / UTL_) — columns are changed_*, never updated_*. */
(function (root) {
    'use strict';
    var S = root.DCS = {};
    S.ORDS = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP';
    S.GW = S.ORDS + '/WAREHOUSEMANAGEMENT/ai';
    S.PUBLIC = S.ORDS + '/WAREHOUSEMANAGEMENT';   // the customer-facing links: …/dc/px/<token>, …/dc/resp/<token>
    S.user = function () { try { return (localStorage.getItem('wms_user') || sessionStorage.getItem('loggedInUser') || localStorage.getItem('loggedInUser') || localStorage.getItem('username') || 'UNKNOWN').trim(); } catch (e) { return 'UNKNOWN'; } };
    S.loginPod = function () { try { return (sessionStorage.getItem('loggedInInstance') || localStorage.getItem('fusionInstance') || localStorage.getItem('instanceName') || 'PROD').toUpperCase(); } catch (e) { return 'PROD'; } };

    // ── host bridge ───────────────────────────────────────────────
    var pending = {};
    S.hasHost = function () { return !!(window.chrome && window.chrome.webview); };
    S.host = function (action, payload, ms) {
        return new Promise(function (resolve, reject) {
            if (!S.hasHost()) { reject(new Error('Open this page inside the Gray\'s WMS app.')); return; }
            var id = 'dc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
            pending[id] = { resolve: resolve, reject: reject };
            window.chrome.webview.postMessage(Object.assign({ action: action, requestId: id, appUser: S.user() }, payload || {}));
            if (ms !== 0) setTimeout(function () { if (pending[id]) { delete pending[id]; reject(new Error(action + ' did not answer in time')); } }, ms || 120000);
        });
    };
    if (S.hasHost()) window.chrome.webview.addEventListener('message', function (ev) {
        var r = ev.data; if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { return; } }
        if (!r || !r.requestId || !pending[r.requestId]) return;
        if (/Progress$/.test(r.action || '')) return;
        var cb = pending[r.requestId]; delete pending[r.requestId];
        if (r.action === 'error') cb.reject(new Error((r.data && r.data.message) || r.message || 'Host error'));
        else if (r.action === 'restResponse') cb.resolve({ rest: true, ok: r.success !== false, status: r.statusCode, text: r.data });
        else cb.resolve(r.data == null ? r : r.data);
    });
    /** A host action whose { ok: false } becomes an Error. */
    S.call = function (action, payload, ms) {
        return S.host(action, payload, ms).then(function (d) { if (d && d.ok === false) { var e = new Error(d.error || action + ' failed'); e.data = d; throw e; } return d; });
    };
    S.post = function (url, body, ms) { return S.host('executePost', { fullUrl: url, body: typeof body === 'string' ? body : JSON.stringify(body || {}) }, ms || 120000).then(restOut); };
    S.get = function (url, ms) { return S.host('executeGet', { fullUrl: url }, ms || 60000).then(restOut); };
    function restOut(r) { var o = { ok: !!(r && r.ok), status: r && r.status, text: r && r.text, json: null }; if (r && !r.rest && typeof r === 'string') o.text = r; try { o.json = JSON.parse(o.text); } catch (e) { } return o; }

    /** Fusion SQL through the app's read-only runner → rows with upper-case keys. */
    S.fusionSql = function (sql, rowLimit) {
        return S.host('fusionSqlExecute', { sql: sql, rowLimit: rowLimit || 20000 }, 600000).then(function (r) {
            if (!r || !r.success) throw new Error((r && r.error) || 'Fusion SQL failed');
            var cols = (r.columns || []).map(function (c) { return String(c.name || c).toUpperCase(); });
            return (r.rows || []).map(function (row) {
                if (!Array.isArray(row)) { var o = {}; Object.keys(row).forEach(function (k) { o[k.toUpperCase()] = row[k]; }); return o; }
                var x = {}; cols.forEach(function (c, i) { x[c] = row[i]; }); return x;
            });
        });
    };

    // ── gateway ───────────────────────────────────────────────────
    S.gw = function (op, payload) {
        return S.post(S.GW + '/' + op, Object.assign({ appUser: S.user() }, payload)).then(function (r) {
            var d = r.json;
            if (!d) throw new Error('Unexpected answer from the database API' + (r.status ? ' (HTTP ' + r.status + ')' : ''));
            if (d.success === false) throw new Error(d.error || d.message || 'Database API error');
            return d;
        });
    };
    S.rows = function (sql, max) {
        return S.gw('executequery', { sql: sql, maxRows: Math.min(max || 500, 1000) }).then(function (d) {
            var cols = (d.columns || []).map(function (c) { return String(c.name || c).toUpperCase(); });
            return (d.rows || []).map(function (r) {
                if (!Array.isArray(r)) { var o = {}; Object.keys(r).forEach(function (k) { o[k.toUpperCase()] = r[k]; }); return o; }
                var x = {}; cols.forEach(function (c, i) { x[c] = r[i]; }); return x;
            });
        });
    };
    S.write = function (sql) { return S.gw('executewrite', { sql: sql }); };
    /** Every row of a query (1,000 per call): sql must end with ORDER BY … */
    S.rowsAll = function (sql, max) {
        var out = [], page = 1000, limit = max || 50000;
        function next(off) { return S.rows(sql + ' OFFSET ' + off + ' ROWS FETCH NEXT ' + page + ' ROWS ONLY', page).then(function (r) { out = out.concat(r); if (r.length < page || out.length >= limit) return out; return next(off + page); }); }
        return next(0);
    };
    S.lit = function (s, max) { if (s == null || s === '') return 'NULL'; s = String(s); if (max && s.length > max) { s = s.slice(0, max); if (/[\uD800-\uDBFF]$/.test(s)) s = s.slice(0, -1); } return "'" + s.replace(/'/g, "''") + "'"; };
    S.num = function (n) { if (n == null || n === '' || isNaN(+n)) return 'NULL'; return String(+n); };
    S.date = function (iso) { return iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? "TO_DATE('" + iso + "', 'YYYY-MM-DD')" : 'NULL'; };
    var TS = "'YYYY-MM-DD HH24:MI'";
    function chunks(a, n) { var o = []; for (var i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; }

    // CLOBs (settings JSON): written as ≤ 1,000-char literals appended, read as 600-char columns, both checked against LENGTH()
    S.cpLen = function (s) { s = String(s == null ? '' : s); var pairs = s.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g); return s.length - (pairs ? pairs.length : 0); };
    function pieces(s, chars, bytes) {
        s = String(s == null ? '' : s); var out = [], i = 0, n = s.length;
        while (i < n) {
            var j = i, cp = 0, b = 0;
            while (j < n && cp < chars) {
                var c = s.charCodeAt(j), w = 1, cb;
                if (c >= 0xD800 && c <= 0xDBFF && j + 1 < n && (s.charCodeAt(j + 1) & 0xFC00) === 0xDC00) { w = 2; cb = 4; } else cb = c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
                if (c === 39) cb = 2;
                if (b + cb > bytes && cp > 0) break;
                j += w; cp++; b += cb;
            }
            out.push(s.slice(i, j)); i = j;
        }
        return out;
    }
    S.writeClob = function (table, col, where, text) {
        text = text == null ? '' : String(text);
        var groups = chunks(pieces(text, 1000, 3800), 16);
        return S.write('UPDATE ' + table + ' SET ' + col + ' = EMPTY_CLOB() WHERE ' + where).then(function () {
            return groups.reduce(function (p, g) { return p.then(function () { return S.write('UPDATE ' + table + ' SET ' + col + ' = ' + col + ' || ' + g.map(function (x) { return "TO_CLOB('" + x.replace(/'/g, "''") + "')"; }).join(' || ') + ' WHERE ' + where); }); }, Promise.resolve());
        }).then(function () { return S.rows('SELECT NVL(LENGTH(' + col + '), 0) AS L FROM ' + table + ' WHERE ' + where, 2); }).then(function (r) {
            var want = S.cpLen(text), got = r.length ? +r[0].L || 0 : -1;
            if (got !== want) throw new Error('APEX kept ' + got + ' of the ' + want + ' characters written to ' + table + '.' + col);
            return want;
        });
    };
    S.readClob = function (table, col, keyCol, ids) {
        var piece = 600, out = {}, lens = {};
        if (!ids.length) return Promise.resolve(out);
        var where = ' WHERE ' + keyCol + ' IN (' + ids.map(function (i) { return S.lit(i); }).join(', ') + ')';
        return S.rows('SELECT ' + keyCol + ' AS K, NVL(LENGTH(' + col + '), 0) AS L FROM ' + table + where, 1000).then(function (r) {
            var max = 0; r.forEach(function (x) { out[x.K] = ''; lens[x.K] = +x.L || 0; max = Math.max(max, lens[x.K]); });
            var calls = []; for (var p = 1; p <= max; p += piece * 200) calls.push(p);
            return calls.reduce(function (pr, p0) {
                return pr.then(function () {
                    var cols = []; for (var k = 0; k < 200 && p0 + k * piece <= max; k++) cols.push('TO_CHAR(SUBSTR(' + col + ', ' + (p0 + k * piece) + ', ' + piece + ')) AS P' + k);
                    return S.rows('SELECT ' + keyCol + ' AS K, ' + cols.join(', ') + ' FROM ' + table + where + ' AND LENGTH(' + col + ') >= ' + p0, 1000).then(function (rows) {
                        rows.forEach(function (x) { var s = ''; for (var k = 0; k < cols.length; k++) { var v = x['P' + k]; if (v == null) break; s += v; } out[x.K] = (out[x.K] || '') + s; });
                    });
                });
            }, Promise.resolve());
        }).then(function () {
            Object.keys(out).forEach(function (k) { if (S.cpLen(out[k]) !== lens[k]) throw new Error(table + '.' + col + ' of ' + k + ' came back damaged from APEX'); });
            return out;
        });
    };

    // ── tables ────────────────────────────────────────────────────
    S.DDL = {
        WMS_DC_SETTINGS: 'CREATE TABLE wms_dc_settings (skey VARCHAR2(60) PRIMARY KEY, sval CLOB, changed_by VARCHAR2(100), changed_date DATE DEFAULT SYSDATE)',
        WMS_DC_CUSTOMERS: "CREATE TABLE wms_dc_customers (bu_id VARCHAR2(30) NOT NULL, account_number VARCHAR2(60) NOT NULL, account_name VARCHAR2(360), stmt_to VARCHAR2(1000), stmt_cc VARCHAR2(1000), delivery VARCHAR2(10), owner_user VARCHAR2(100), phone VARCHAR2(100), contact_name VARCHAR2(200), tags VARCHAR2(400), notes VARCHAR2(4000), on_hold VARCHAR2(1) DEFAULT 'N', changed_by VARCHAR2(100), changed_date DATE DEFAULT SYSDATE, CONSTRAINT wms_dc_customers_pk PRIMARY KEY (bu_id, account_number))",
        WMS_DC_RUNS: "CREATE TABLE wms_dc_runs (run_id VARCHAR2(40) PRIMARY KEY, pod VARCHAR2(20), bu_id VARCHAR2(30), bu_name VARCHAR2(240), stmt_date VARCHAR2(10), title VARCHAR2(300), customers NUMBER, emailed NUMBER DEFAULT 0, posted NUMBER DEFAULT 0, failed NUMBER DEFAULT 0, skipped NUMBER DEFAULT 0, total_balance NUMBER, status VARCHAR2(20), method VARCHAR2(20), mailbox VARCHAR2(320), source_kind VARCHAR2(10), app_user VARCHAR2(100), machine VARCHAR2(100), started_at DATE DEFAULT SYSDATE, finished_at DATE, note VARCHAR2(1000))",
        WMS_DC_STMTS: "CREATE TABLE wms_dc_stmts (stmt_id VARCHAR2(40) PRIMARY KEY, run_id VARCHAR2(40), pod VARCHAR2(20), bu_id VARCHAR2(30), bu_name VARCHAR2(240), company VARCHAR2(200), account_number VARCHAR2(60), account_name VARCHAR2(360), stmt_date VARCHAR2(10), currency VARCHAR2(10), balance NUMBER, overdue NUMBER, aging_json VARCHAR2(1000), delivery VARCHAR2(10), email_to VARCHAR2(1000), email_cc VARCHAR2(1000), subject VARCHAR2(400), file_name VARCHAR2(300), file_path VARCHAR2(600), sha256 VARCHAR2(64), bytes_n NUMBER, status VARCHAR2(20), error_text VARCHAR2(2000), method VARCHAR2(20), mailbox VARCHAR2(320), app_user VARCHAR2(100), machine VARCHAR2(100), created_at DATE DEFAULT SYSDATE, generated_at DATE, sent_at DATE, token VARCHAR2(64), tracked VARCHAR2(1) DEFAULT 'N', opens NUMBER DEFAULT 0, first_open DATE, last_open DATE, last_agent VARCHAR2(400), delivered_at DATE, read_at DATE, bounced_at DATE, bounce_text VARCHAR2(1000), resp_status VARCHAR2(20), resp_comment VARCHAR2(2000), resp_at DATE, resp_agent VARCHAR2(400), resent_of VARCHAR2(40))",
        WMS_DC_ACTIVITY: "CREATE TABLE wms_dc_activity (act_id VARCHAR2(40) PRIMARY KEY, bu_id VARCHAR2(30), account_number VARCHAR2(60), account_name VARCHAR2(360), kind VARCHAR2(20), subject VARCHAR2(400), body VARCHAR2(4000), amount NUMBER, due_date DATE, status VARCHAR2(20) DEFAULT 'OPEN', ref_id VARCHAR2(40), source VARCHAR2(20) DEFAULT 'USER', assigned_to VARCHAR2(100), created_by VARCHAR2(100), created_at DATE DEFAULT SYSDATE, done_by VARCHAR2(100), done_at DATE, outcome VARCHAR2(1000))",
        WMS_DC_GIF: 'CREATE TABLE wms_dc_gif (id NUMBER PRIMARY KEY, gif BLOB)',
        WMS_DC_CYCLES: "CREATE TABLE wms_dc_cycles (cycle_id VARCHAR2(40) PRIMARY KEY, pod VARCHAR2(20), bu_id VARCHAR2(30), bu_name VARCHAR2(240), period VARCHAR2(7), stmt_date VARCHAR2(10), title VARCHAR2(300), status VARCHAR2(20), owner_user VARCHAR2(100), due_date VARCHAR2(10), tolerance NUMBER, note VARCHAR2(2000), created_by VARCHAR2(100), created_at DATE DEFAULT SYSDATE, " +
            "checks_at DATE, checks_by VARCHAR2(100), checks_score NUMBER, snap_at DATE, snap_by VARCHAR2(100), snap_source VARCHAR2(10), customers NUMBER, total_due NUMBER, owed NUMBER, overdue NUMBER, cur_amt NUMBER, d30 NUMBER, d60 NUMBER, d90 NUMBER, d90p NUMBER, credit_n NUMBER, credit_amt NUMBER, email_n NUMBER, post_n NUMBER, none_n NUMBER, items_n NUMBER, new_n NUMBER, cleared_n NUMBER, up_n NUMBER, down_n NUMBER, prev_total NUMBER, " +
            "stmt_path VARCHAR2(1000), stmt_dm VARCHAR2(1000), stmt_sha VARCHAR2(64), stmt_changed VARCHAR2(1), stmt_sql CLOB, stmt_def CLOB, review_at DATE, review_by VARCHAR2(100), review_note VARCHAR2(2000), sent_n NUMBER, posted_n NUMBER, failed_n NUMBER, cover_pct NUMBER, closed_at DATE, closed_by VARCHAR2(100), close_note VARCHAR2(2000), CONSTRAINT wms_dc_cycles_uk UNIQUE (pod, bu_id, period))",
        WMS_DC_CYCLE_CHECKS: "CREATE TABLE wms_dc_cycle_checks (cycle_id VARCHAR2(40) NOT NULL, check_id VARCHAR2(40) NOT NULL, title VARCHAR2(300), area VARCHAR2(60), severity VARCHAR2(10), kind VARCHAR2(10), status VARCHAR2(20), rows_n NUMBER, amount NUMBER, ms NUMBER, error_text VARCHAR2(2000), sql_text CLOB, sample_json CLOB, ran_at DATE, ran_by VARCHAR2(100), bypass_note VARCHAR2(2000), bypass_by VARCHAR2(100), bypass_at DATE, CONSTRAINT wms_dc_cycle_checks_pk PRIMARY KEY (cycle_id, check_id))",
        WMS_DC_CYCLE_BAL: "CREATE TABLE wms_dc_cycle_bal (cycle_id VARCHAR2(40) NOT NULL, account_number VARCHAR2(60) NOT NULL, account_name VARCHAR2(360), currency VARCHAR2(10), balance NUMBER, overdue NUMBER, cur_amt NUMBER, d30 NUMBER, d60 NUMBER, d90 NUMBER, d90p NUMBER, items_n NUMBER, email VARCHAR2(1000), delivery VARCHAR2(10), why VARCHAR2(400), score NUMBER, prev_balance NUMBER, CONSTRAINT wms_dc_cycle_bal_pk PRIMARY KEY (cycle_id, account_number))",
        WMS_DC_CYCLE_EVENTS: 'CREATE TABLE wms_dc_cycle_events (event_id VARCHAR2(40) PRIMARY KEY, cycle_id VARCHAR2(40), event VARCHAR2(40), detail VARCHAR2(2000), by_user VARCHAR2(100), event_at DATE DEFAULT SYSDATE)'
    };
    S.INDEXES = [
        'CREATE INDEX wms_dc_stmts_acct ON wms_dc_stmts (bu_id, account_number)', 'CREATE INDEX wms_dc_stmts_tok ON wms_dc_stmts (token)',
        'CREATE INDEX wms_dc_stmts_run ON wms_dc_stmts (run_id)', 'CREATE INDEX wms_dc_act_acct ON wms_dc_activity (bu_id, account_number)'
    ];
    var ensured = null;
    S.ensure = function () {
        if (ensured) return ensured;
        var names = Object.keys(S.DDL);
        ensured = S.rows("SELECT table_name AS T FROM user_tables WHERE table_name IN ('" + names.join("','") + "')", 20).then(function (r) {
            var have = {}; r.forEach(function (x) { have[String(x.T).toUpperCase()] = 1; });
            var missing = names.filter(function (t) { return !have[t]; });
            return missing.reduce(function (p, t) { return p.then(function () { return S.write(S.DDL[t]).catch(function (e) { if (!/ORA-00955/.test(e.message)) throw e; }); }); }, Promise.resolve())
                .then(function () { if (missing.indexOf('WMS_DC_STMTS') < 0 && missing.indexOf('WMS_DC_ACTIVITY') < 0) return; return S.INDEXES.reduce(function (p, d) { return p.then(function () { return S.write(d).catch(function () { }); }); }, Promise.resolve()); })
                .then(function () { if (missing.indexOf('WMS_DC_GIF') >= 0) return S.write("INSERT INTO wms_dc_gif (id, gif) SELECT 1, TO_BLOB(HEXTORAW('47494638396101000100800000FFFFFF00000021F90401000000002C00000000010001000002024401003B')) FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_dc_gif WHERE id = 1)"); })
                .then(function () {   // tables made before statement cycles get the cycle column
                    return S.rows("SELECT table_name AS T FROM user_tab_columns WHERE table_name IN ('WMS_DC_STMTS', 'WMS_DC_RUNS') AND column_name = 'CYCLE_ID'", 5).then(function (c) {
                        var has = {}; c.forEach(function (x) { has[String(x.T).toUpperCase()] = 1; });
                        return ['WMS_DC_STMTS', 'WMS_DC_RUNS'].filter(function (t) { return !has[t]; }).reduce(function (p, t) { return p.then(function () { return S.write('ALTER TABLE ' + t.toLowerCase() + ' ADD (cycle_id VARCHAR2(40))').catch(function (e) { if (!/ORA-01430/.test(e.message)) throw e; }); }); }, Promise.resolve());
                    });
                })
                .then(function () { return { created: missing }; });
        }).catch(function (e) { ensured = null; throw e; });
        return ensured;
    };

    // ── the database clock (times are written with SYSDATE; this PC shows its own wall time) ──
    S.clock = function () {
        if (S._clk) return S._clk;
        S._clk = S.rows("SELECT TO_CHAR(SYSDATE, 'YYYY-MM-DD\"T\"HH24:MI:SS') AS NOW_ FROM dual").then(function (r) {
            var db = Date.parse(r[0].NOW_ + 'Z'), here = Date.now() - new Date().getTimezoneOffset() * 60000;
            S.offset = Math.round((here - db) / 900000) * 900000; return S.offset;
        }).catch(function () { S.offset = 0; return 0; });
        return S._clk;
    };
    /** 'YYYY-MM-DD HH24:MI' as written by the database → the same moment in this PC's wall time, same format */
    S.local = function (s) {
        if (!s || !S.offset) return s || '';
        var t = Date.parse(String(s).replace(' ', 'T') + ':00Z'); if (isNaN(t)) return s;
        return new Date(t + S.offset).toISOString().slice(0, 16).replace('T', ' ');
    };

    // ── settings ──────────────────────────────────────────────────
    S.settings = {
        get: function (key) {
            return S.ensure().then(function () { return S.readClob('wms_dc_settings', 'sval', 'skey', [key]); })
                .then(function (m) { if (m[key] == null || m[key] === '') return null; try { return JSON.parse(m[key]); } catch (e) { return null; } });
        },
        save: function (key, value) {
            var me = S.lit(S.user());
            return S.ensure().then(function () {
                return S.write('MERGE INTO wms_dc_settings t USING (SELECT ' + S.lit(key) + ' AS skey FROM dual) s ON (t.skey = s.skey) WHEN MATCHED THEN UPDATE SET changed_by = ' + me + ', changed_date = SYSDATE WHEN NOT MATCHED THEN INSERT (skey, sval, changed_by, changed_date) VALUES (' + S.lit(key) + ', EMPTY_CLOB(), ' + me + ', SYSDATE)');
            }).then(function () { return S.writeClob('wms_dc_settings', 'sval', 'skey = ' + S.lit(key), JSON.stringify(value)); });
        }
    };

    // ── customer cards ────────────────────────────────────────────
    var CUST_COLS = "bu_id AS BU_ID, account_number AS ACCOUNT_NUMBER, account_name AS ACCOUNT_NAME, stmt_to AS STMT_TO, stmt_cc AS STMT_CC, delivery AS DELIVERY, owner_user AS OWNER_USER, phone AS PHONE, contact_name AS CONTACT_NAME, tags AS TAGS, notes AS NOTES, on_hold AS ON_HOLD, changed_by AS CHANGED_BY, TO_CHAR(changed_date, " + TS + ") AS CHANGED_AT";
    S.cust = {
        list: function (buId) { return S.ensure().then(function () { return S.rowsAll('SELECT ' + CUST_COLS + ' FROM wms_dc_customers' + (buId ? ' WHERE bu_id = ' + S.lit(buId) : '') + ' ORDER BY bu_id, account_number'); }); },
        save: function (c) {
            var me = S.lit(S.user()), k = 'bu_id = ' + S.lit(c.BU_ID) + ' AND account_number = ' + S.lit(c.ACCOUNT_NUMBER);
            var set = ['account_name = ' + S.lit(c.ACCOUNT_NAME, 360), 'stmt_to = ' + S.lit(c.STMT_TO, 1000), 'stmt_cc = ' + S.lit(c.STMT_CC, 1000), 'delivery = ' + S.lit(c.DELIVERY, 10), 'owner_user = ' + S.lit(c.OWNER_USER, 100),
                'phone = ' + S.lit(c.PHONE, 100), 'contact_name = ' + S.lit(c.CONTACT_NAME, 200), 'tags = ' + S.lit(c.TAGS, 400), 'notes = ' + S.lit(c.NOTES, 4000), 'on_hold = ' + S.lit(c.ON_HOLD === 'Y' ? 'Y' : 'N'), 'changed_by = ' + me, 'changed_date = SYSDATE'];
            return S.ensure().then(function () {
                return S.write('MERGE INTO wms_dc_customers t USING (SELECT ' + S.lit(c.BU_ID) + ' AS bu_id, ' + S.lit(c.ACCOUNT_NUMBER) + ' AS account_number FROM dual) s ON (t.bu_id = s.bu_id AND t.account_number = s.account_number)' +
                    ' WHEN NOT MATCHED THEN INSERT (bu_id, account_number) VALUES (' + S.lit(c.BU_ID) + ', ' + S.lit(c.ACCOUNT_NUMBER) + ')');
            }).then(function () { return S.write('UPDATE wms_dc_customers SET ' + set.join(', ') + ' WHERE ' + k); });
        }
    };

    // ── runs ──────────────────────────────────────────────────────
    S.run = {
        start: function (r) {
            return S.ensure().then(function () {
                return S.write('INSERT INTO wms_dc_runs (run_id, cycle_id, pod, bu_id, bu_name, stmt_date, title, customers, total_balance, status, method, mailbox, source_kind, app_user, machine, started_at, note) VALUES (' +
                    [S.lit(r.id), S.lit(r.cycleId), S.lit(r.pod), S.lit(r.buId), S.lit(r.buName, 240), S.lit(r.stmtDate), S.lit(r.title, 300), S.num(r.customers), S.num(r.total), "'RUNNING'", S.lit(r.method), S.lit(r.mailbox, 320), S.lit(r.sourceKind), S.lit(S.user(), 100), S.lit(r.machine, 100), 'SYSDATE', S.lit(r.note, 1000)].join(', ') + ')');
            });
        },
        finish: function (id, c, status) {
            return S.write('UPDATE wms_dc_runs SET emailed = ' + S.num(c.emailed) + ', posted = ' + S.num(c.posted) + ', failed = ' + S.num(c.failed) + ', skipped = ' + S.num(c.skipped) + ', status = ' + S.lit(status) + ', finished_at = SYSDATE WHERE run_id = ' + S.lit(id));
        },
        list: function (limit) {
            return S.ensure().then(function () {
                return S.rows("SELECT run_id AS RUN_ID, pod AS POD, bu_id AS BU_ID, bu_name AS BU_NAME, stmt_date AS STMT_DATE, title AS TITLE, customers AS CUSTOMERS, emailed AS EMAILED, posted AS POSTED, failed AS FAILED, skipped AS SKIPPED, total_balance AS TOTAL_BALANCE, status AS STATUS, method AS METHOD, mailbox AS MAILBOX, app_user AS APP_USER, machine AS MACHINE, TO_CHAR(started_at, " + TS + ") AS STARTED_AT, TO_CHAR(finished_at, " + TS + ") AS FINISHED_AT FROM wms_dc_runs ORDER BY started_at DESC FETCH FIRST " + (limit || 100) + ' ROWS ONLY', 1000);
            });
        }
    };

    // ── statements ────────────────────────────────────────────────
    var STMT_COLS = ['STMT_ID', 'RUN_ID', 'CYCLE_ID', 'POD', 'BU_ID', 'BU_NAME', 'COMPANY', 'ACCOUNT_NUMBER', 'ACCOUNT_NAME', 'STMT_DATE', 'CURRENCY', 'BALANCE', 'OVERDUE', 'AGING_JSON', 'DELIVERY', 'EMAIL_TO', 'EMAIL_CC', 'SUBJECT', 'FILE_NAME', 'FILE_PATH', 'SHA256', 'BYTES_N', 'STATUS', 'ERROR_TEXT', 'METHOD', 'MAILBOX', 'APP_USER', 'MACHINE', 'TOKEN', 'TRACKED', 'OPENS', 'LAST_AGENT', 'BOUNCE_TEXT', 'RESP_STATUS', 'RESP_COMMENT', 'RESP_AGENT', 'RESENT_OF']
        .map(function (c) { return c.toLowerCase() + ' AS ' + c; })
        .concat(['CREATED_AT', 'GENERATED_AT', 'SENT_AT', 'FIRST_OPEN', 'LAST_OPEN', 'DELIVERED_AT', 'READ_AT', 'BOUNCED_AT', 'RESP_AT'].map(function (c) { return 'TO_CHAR(' + c.toLowerCase() + ', ' + TS + ') AS ' + c; })).join(', ');
    S.stmt = {
        /** a new statement row before anything is sent: status GENERATED / FAILED / POSTED / SKIPPED … */
        insert: function (s) {
            return S.write('INSERT INTO wms_dc_stmts (stmt_id, run_id, cycle_id, pod, bu_id, bu_name, company, account_number, account_name, stmt_date, currency, balance, overdue, aging_json, delivery, email_to, email_cc, subject, file_name, file_path, sha256, bytes_n, status, error_text, app_user, machine, created_at, generated_at, token, tracked, resent_of) VALUES (' +
                [S.lit(s.id), S.lit(s.runId), S.lit(s.cycleId), S.lit(s.pod), S.lit(s.buId), S.lit(s.buName, 240), S.lit(s.company, 200), S.lit(s.account, 60), S.lit(s.name, 360), S.lit(s.stmtDate), S.lit(s.currency, 10), S.num(s.balance), S.num(s.overdue), S.lit(s.aging ? JSON.stringify(s.aging) : null, 1000),
                    S.lit(s.delivery, 10), S.lit(s.to, 1000), S.lit(s.cc, 1000), S.lit(s.subject, 400), S.lit(s.fileName, 300), S.lit(s.filePath, 600), S.lit(s.sha), S.num(s.bytes), S.lit(s.status), S.lit(s.error, 2000), S.lit(S.user(), 100), S.lit(s.machine, 100), 'SYSDATE', s.sha ? 'SYSDATE' : 'NULL', S.lit(s.token), S.lit(s.tracked ? 'Y' : 'N'), S.lit(s.resentOf)].join(', ') + ')');
        },
        /** after the send: SENT / DRAFT / FAILED with how and from which mailbox */
        sent: function (id, r) {
            return S.write('UPDATE wms_dc_stmts SET status = ' + S.lit(r.status) + ', method = ' + S.lit(r.method, 20) + ', mailbox = ' + S.lit(r.mailbox, 320) + ', error_text = ' + S.lit(r.error, 2000) + (r.status === 'SENT' ? ', sent_at = SYSDATE' : '') + ' WHERE stmt_id = ' + S.lit(id));
        },
        mark: function (id, sets) {
            var parts = [];
            Object.keys(sets).forEach(function (k) { var v = sets[k]; parts.push(k + ' = ' + (v === 'SYSDATE' ? 'SYSDATE' : typeof v === 'number' ? S.num(v) : S.lit(v, 2000))); });
            return S.write('UPDATE wms_dc_stmts SET ' + parts.join(', ') + ' WHERE stmt_id = ' + S.lit(id));
        },
        /** f = {from, to (YYYY-MM-DD, created), buId, account, status, stmtDate, q, runId, limit} */
        search: function (f) {
            f = f || {};
            var w = ['1 = 1'];
            if (f.from) w.push('created_at >= ' + S.date(f.from));
            if (f.to) w.push('created_at < ' + S.date(f.to) + ' + 1');
            if (f.buId) w.push('bu_id = ' + S.lit(f.buId));
            if (f.account) w.push('account_number = ' + S.lit(f.account));
            if (f.stmtDate) w.push('stmt_date = ' + S.lit(f.stmtDate));
            if (f.runId) w.push('run_id = ' + S.lit(f.runId));
            if (f.cycleId) w.push('cycle_id = ' + S.lit(f.cycleId));
            if (f.status) w.push('status = ' + S.lit(f.status));
            if (f.resp) w.push('resp_status = ' + S.lit(f.resp));
            if (f.q) { var q = S.lit('%' + String(f.q).toUpperCase().replace(/[\\%_]/g, function (c) { return '\\' + c; }) + '%', 200); w.push('(UPPER(account_number) LIKE ' + q + " ESCAPE '\\' OR UPPER(account_name) LIKE " + q + " ESCAPE '\\' OR UPPER(email_to) LIKE " + q + " ESCAPE '\\')"); }
            return S.ensure().then(function () { return S.rowsAll('SELECT ' + STMT_COLS + ' FROM wms_dc_stmts WHERE ' + w.join(' AND ') + ' ORDER BY created_at DESC, stmt_id', f.limit || 5000); });
        },
        /** the latest statement row per customer (BU × account) */
        latest: function (buId) {
            return S.ensure().then(function () {
                return S.rowsAll('SELECT * FROM (SELECT ' + STMT_COLS + ', ROW_NUMBER() OVER (PARTITION BY bu_id, account_number ORDER BY created_at DESC, stmt_id DESC) AS RN_ FROM wms_dc_stmts' + (buId ? ' WHERE bu_id = ' + S.lit(buId) : '') + ') WHERE RN_ = 1 ORDER BY ACCOUNT_NUMBER', 50000);
            });
        }
    };

    // ── the CRM timeline ─────────────────────────────────────────
    var ACT_COLS = "act_id AS ACT_ID, bu_id AS BU_ID, account_number AS ACCOUNT_NUMBER, account_name AS ACCOUNT_NAME, kind AS KIND, subject AS SUBJECT, body AS BODY, amount AS AMOUNT, TO_CHAR(due_date, 'YYYY-MM-DD') AS DUE_DATE, status AS STATUS, ref_id AS REF_ID, source AS SOURCE, assigned_to AS ASSIGNED_TO, created_by AS CREATED_BY, TO_CHAR(created_at, " + TS + ") AS CREATED_AT, done_by AS DONE_BY, TO_CHAR(done_at, " + TS + ") AS DONE_AT, outcome AS OUTCOME";
    S.act = {
        add: function (a) {
            return S.ensure().then(function () {
                return S.write('INSERT INTO wms_dc_activity (act_id, bu_id, account_number, account_name, kind, subject, body, amount, due_date, status, ref_id, source, assigned_to, created_by, created_at) VALUES (' +
                    [S.lit(a.id), S.lit(a.buId), S.lit(a.account, 60), S.lit(a.name, 360), S.lit(a.kind, 20), S.lit(a.subject, 400), S.lit(a.body, 4000), S.num(a.amount), S.date(a.due), S.lit(a.status || 'OPEN'), S.lit(a.ref), S.lit(a.source || 'USER'), S.lit(a.assignedTo, 100), S.lit(S.user(), 100), 'SYSDATE'].join(', ') + ')');
            });
        },
        close: function (id, status, outcome) {
            return S.write('UPDATE wms_dc_activity SET status = ' + S.lit(status, 20) + ', outcome = ' + S.lit(outcome, 1000) + ', done_by = ' + S.lit(S.user(), 100) + ', done_at = SYSDATE WHERE act_id = ' + S.lit(id));
        },
        /** f = {buId, account, open (only OPEN), kinds [], limit} */
        list: function (f) {
            f = f || {};
            var w = ['1 = 1'];
            if (f.buId) w.push('bu_id = ' + S.lit(f.buId));
            if (f.account) w.push('account_number = ' + S.lit(f.account));
            if (f.open) w.push("status = 'OPEN'");
            if (f.kinds && f.kinds.length) w.push('kind IN (' + f.kinds.map(function (k) { return S.lit(k); }).join(', ') + ')');
            if (f.since) w.push('created_at >= ' + S.date(f.since));
            return S.ensure().then(function () { return S.rowsAll('SELECT ' + ACT_COLS + ' FROM wms_dc_activity WHERE ' + w.join(' AND ') + ' ORDER BY created_at DESC, act_id', f.limit || 10000); });
        },
        /** last contact per customer (any activity by a person, or a statement that was sent) */
        lastContact: function () {
            return S.ensure().then(function () {
                return S.rowsAll("SELECT bu_id AS BU_ID, account_number AS ACCOUNT_NUMBER, TO_CHAR(MAX(at_), 'YYYY-MM-DD') AS LAST_AT FROM (SELECT bu_id, account_number, created_at AS at_ FROM wms_dc_activity WHERE source = 'USER' AND kind IN ('CALL', 'EMAIL', 'VISIT', 'PROMISE', 'NOTE') UNION ALL SELECT bu_id, account_number, sent_at FROM wms_dc_stmts WHERE status = 'SENT') GROUP BY bu_id, account_number ORDER BY 1, 2", 50000);
            });
        }
    };

    // ── statement cycles ─────────────────────────────────────────
    /** sets {col: value} → "col = literal, …"; 'SYSDATE' stays a function, numbers stay numbers, {sql} is written as is */
    function setList(sets) {
        return Object.keys(sets).map(function (k) { var v = sets[k]; return k + ' = ' + (v === 'SYSDATE' ? 'SYSDATE' : v && typeof v === 'object' && v.sql ? v.sql : typeof v === 'number' ? S.num(v) : S.lit(v, 2000)); }).join(', ');
    }
    var CY_DATES = ['CREATED_AT', 'CHECKS_AT', 'SNAP_AT', 'REVIEW_AT', 'CLOSED_AT'];
    var CY_COLS = ['CYCLE_ID', 'POD', 'BU_ID', 'BU_NAME', 'PERIOD', 'STMT_DATE', 'TITLE', 'STATUS', 'OWNER_USER', 'DUE_DATE', 'TOLERANCE', 'NOTE', 'CREATED_BY', 'CHECKS_BY', 'CHECKS_SCORE', 'SNAP_BY', 'SNAP_SOURCE', 'CUSTOMERS', 'TOTAL_DUE', 'OWED', 'OVERDUE', 'CUR_AMT', 'D30', 'D60', 'D90', 'D90P',
        'CREDIT_N', 'CREDIT_AMT', 'EMAIL_N', 'POST_N', 'NONE_N', 'ITEMS_N', 'NEW_N', 'CLEARED_N', 'UP_N', 'DOWN_N', 'PREV_TOTAL', 'STMT_PATH', 'STMT_DM', 'STMT_SHA', 'STMT_CHANGED', 'REVIEW_BY', 'REVIEW_NOTE', 'SENT_N', 'POSTED_N', 'FAILED_N', 'COVER_PCT', 'CLOSED_BY', 'CLOSE_NOTE']
        .map(function (c) { return c.toLowerCase() + ' AS ' + c; }).concat(CY_DATES.map(function (c) { return 'TO_CHAR(' + c.toLowerCase() + ', ' + TS + ') AS ' + c; })).join(', ');
    var CK_COLS = "cycle_id AS CYCLE_ID, check_id AS CHECK_ID, title AS TITLE, area AS AREA, severity AS SEVERITY, kind AS KIND, status AS STATUS, rows_n AS ROWS_N, amount AS AMOUNT, ms AS MS, error_text AS ERROR_TEXT, ran_by AS RAN_BY, TO_CHAR(ran_at, " + TS + ") AS RAN_AT, bypass_note AS BYPASS_NOTE, bypass_by AS BYPASS_BY, TO_CHAR(bypass_at, " + TS + ") AS BYPASS_AT";
    S.cycle = {
        list: function () { return S.ensure().then(function () { return S.rowsAll('SELECT ' + CY_COLS + ' FROM wms_dc_cycles ORDER BY period DESC, bu_name, cycle_id', 2000); }); },
        get: function (id) { return S.rows('SELECT ' + CY_COLS + ' FROM wms_dc_cycles WHERE cycle_id = ' + S.lit(id), 2).then(function (r) { return r[0] || null; }); },
        create: function (c) {
            return S.ensure().then(function () {
                return S.write('INSERT INTO wms_dc_cycles (cycle_id, pod, bu_id, bu_name, period, stmt_date, title, status, owner_user, due_date, tolerance, note, created_by, created_at) VALUES (' +
                    [S.lit(c.id), S.lit(c.pod), S.lit(c.buId), S.lit(c.buName, 240), S.lit(c.period), S.lit(c.stmtDate), S.lit(c.title, 300), "'OPEN'", S.lit(c.owner, 100), S.lit(c.due), S.num(c.tolerance), S.lit(c.note, 2000), S.lit(S.user(), 100), 'SYSDATE'].join(', ') + ')');
            }).catch(function (e) { if (/ORA-00001|unique constraint/i.test(e.message)) throw new Error('There is already a cycle for this business unit and month on ' + c.pod + '.'); throw e; });
        },
        set: function (id, sets) { return S.write('UPDATE wms_dc_cycles SET ' + setList(sets) + ' WHERE cycle_id = ' + S.lit(id)); },
        sql: function (id) { return S.readClob('wms_dc_cycles', 'stmt_sql', 'cycle_id', [id]).then(function (m) { return m[id] || ''; }); },
        def: function (id) { return S.readClob('wms_dc_cycles', 'stmt_def', 'cycle_id', [id]).then(function (m) { return m[id] || ''; }); },
        saveSql: function (id, sqlText, defText) { return S.writeClob('wms_dc_cycles', 'stmt_sql', 'cycle_id = ' + S.lit(id), sqlText).then(function () { return defText != null ? S.writeClob('wms_dc_cycles', 'stmt_def', 'cycle_id = ' + S.lit(id), defText) : null; }); },
        /** the latest earlier cycle of the same business unit and pod with a captured statement query / an archive */
        previous: function (c, what) {
            var cond = what === 'sql' ? 'stmt_sha IS NOT NULL' : 'snap_at IS NOT NULL';
            return S.rows('SELECT cycle_id AS CYCLE_ID, period AS PERIOD, stmt_sha AS STMT_SHA FROM wms_dc_cycles WHERE pod = ' + S.lit(c.POD) + ' AND bu_id = ' + S.lit(c.BU_ID) + ' AND period < ' + S.lit(c.PERIOD) + ' AND ' + cond + ' ORDER BY period DESC FETCH FIRST 1 ROWS ONLY', 2).then(function (r) { return r[0] || null; });
        },
        event: function (id, ev, detail) {
            return S.write('INSERT INTO wms_dc_cycle_events (event_id, cycle_id, event, detail, by_user, event_at) VALUES (' + [S.lit('ev' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)), S.lit(id), S.lit(ev, 40), S.lit(detail, 2000), S.lit(S.user(), 100), 'SYSDATE'].join(', ') + ')').catch(function (e) { console.warn('[DC] cycle event not kept', e); });
        },
        events: function (id) { return S.rows("SELECT event AS EVENT, detail AS DETAIL, by_user AS BY_USER, TO_CHAR(event_at, " + TS + ") AS EVENT_AT FROM wms_dc_cycle_events WHERE cycle_id = " + S.lit(id) + ' ORDER BY event_at DESC, event_id DESC', 1000); },
        checks: function (id) { return S.rows('SELECT ' + CK_COLS + ' FROM wms_dc_cycle_checks WHERE cycle_id = ' + S.lit(id) + ' ORDER BY check_id', 200); },
        /** one check's result: the row, then the SQL that ran and the first 50 exception rows as CLOBs */
        saveCheck: function (id, c, r) {
            var k = 'cycle_id = ' + S.lit(id) + ' AND check_id = ' + S.lit(c.id);
            var sets = { title: c.title, area: c.area, severity: c.severity, kind: c.kind, status: r.status, rows_n: r.rows == null ? null : +r.rows, amount: r.amount == null ? null : +r.amount, ms: r.ms == null ? null : +r.ms, error_text: r.error || null, ran_at: 'SYSDATE', ran_by: S.user(), bypass_note: null, bypass_by: null, bypass_at: { sql: 'NULL' } };
            return S.write('MERGE INTO wms_dc_cycle_checks t USING (SELECT ' + S.lit(id) + ' AS cycle_id, ' + S.lit(c.id) + ' AS check_id FROM dual) s ON (t.cycle_id = s.cycle_id AND t.check_id = s.check_id) WHEN NOT MATCHED THEN INSERT (cycle_id, check_id) VALUES (' + S.lit(id) + ', ' + S.lit(c.id) + ')')
                .then(function () { return S.write('UPDATE wms_dc_cycle_checks SET ' + setList(sets) + ' WHERE ' + k); })
                .then(function () { return S.writeClob('wms_dc_cycle_checks', 'sql_text', k, r.sql || ''); })
                .then(function () { return S.writeClob('wms_dc_cycle_checks', 'sample_json', k, JSON.stringify((r.sample || []).slice(0, 50))); });
        },
        bypass: function (id, checkId, note) {
            return S.write('UPDATE wms_dc_cycle_checks SET bypass_note = ' + S.lit(note, 2000) + ', bypass_by = ' + S.lit(S.user(), 100) + ', bypass_at = SYSDATE WHERE cycle_id = ' + S.lit(id) + ' AND check_id = ' + S.lit(checkId));
        },
        checkDetail: function (id, checkId) {
            var key = id + '|' + checkId, where = "cycle_id || '|' || check_id";
            return Promise.all([S.readClob('wms_dc_cycle_checks', 'sql_text', where, [key]), S.readClob('wms_dc_cycle_checks', 'sample_json', where, [key])]).then(function (r) {
                var sample = []; try { sample = JSON.parse(r[1][key] || '[]'); } catch (e) { }
                return { sql: r[0][key] || '', sample: sample };
            });
        },
        /** the archive: every row replaced in INSERT … SELECT … FROM dual UNION ALL chunks of 40 */
        saveBal: function (id, rows) {
            return S.write('DELETE FROM wms_dc_cycle_bal WHERE cycle_id = ' + S.lit(id)).then(function () {
                return chunks(rows, 40).reduce(function (p, g) {
                    return p.then(function () {
                        return S.write('INSERT INTO wms_dc_cycle_bal (cycle_id, account_number, account_name, currency, balance, overdue, cur_amt, d30, d60, d90, d90p, items_n, email, delivery, why, score, prev_balance) ' + g.map(function (r) {
                            var a = r.aging || {};
                            return 'SELECT ' + [S.lit(id), S.lit(r.account, 60), S.lit(r.name, 360), S.lit(r.currency, 10), S.num(r.balance), S.num(r.overdue), r.aging ? S.num(a.current) : 'NULL', r.aging ? S.num(a.d30) : 'NULL', r.aging ? S.num(a.d60) : 'NULL', r.aging ? S.num(a.d90) : 'NULL', r.aging ? S.num(a.d90p) : 'NULL',
                                S.num(r.items), S.lit(r.email, 1000), S.lit(r.delivery, 10), S.lit(r.why, 400), S.num(r.score), S.num(r.prev)].join(', ') + ' FROM dual';
                        }).join(' UNION ALL '));
                    });
                }, Promise.resolve());
            }).then(function () { return S.rows('SELECT COUNT(*) AS N FROM wms_dc_cycle_bal WHERE cycle_id = ' + S.lit(id), 2); }).then(function (r) {
                var n = r.length ? +r[0].N : -1;
                if (n !== rows.length) throw new Error('APEX kept ' + n + ' of the ' + rows.length + ' archived balances');
                return n;
            });
        },
        bal: function (id) { return S.rowsAll('SELECT cycle_id AS CYCLE_ID, account_number AS ACCOUNT_NUMBER, account_name AS ACCOUNT_NAME, currency AS CURRENCY, balance AS BALANCE, overdue AS OVERDUE, cur_amt AS CUR_AMT, d30 AS D30, d60 AS D60, d90 AS D90, d90p AS D90P, items_n AS ITEMS_N, email AS EMAIL, delivery AS DELIVERY, why AS WHY, score AS SCORE, prev_balance AS PREV_BALANCE FROM wms_dc_cycle_bal WHERE cycle_id = ' + S.lit(id) + ' ORDER BY account_number', 50000); }
    };

    // ── the public links: the tracking picture and the agree / dispute page ──
    var PX = "CREATE OR REPLACE PROCEDURE wms_dc_px (p_tok IN VARCHAR2) AS v_gif BLOB; v_ua VARCHAR2(400); BEGIN " +
        "BEGIN v_ua := SUBSTR(OWA_UTIL.get_cgi_env('HTTP_USER_AGENT'), 1, 400); EXCEPTION WHEN OTHERS THEN v_ua := NULL; END; " +
        "IF p_tok IS NOT NULL AND LENGTH(p_tok) BETWEEN 16 AND 64 THEN UPDATE wms_dc_stmts SET opens = NVL(opens, 0) + 1, first_open = NVL(first_open, SYSDATE), last_open = SYSDATE, last_agent = v_ua WHERE token = p_tok; COMMIT; END IF; " +
        "SELECT gif INTO v_gif FROM wms_dc_gif WHERE id = 1; OWA_UTIL.mime_header('image/gif', FALSE); HTP.p('Cache-Control: no-store, no-cache, must-revalidate, max-age=0'); HTP.p('Pragma: no-cache'); OWA_UTIL.http_header_close; " +
        "WPG_DOCLOAD.download_file(v_gif); END wms_dc_px;";
    S.RESP_SQL = "CREATE OR REPLACE PROCEDURE wms_dc_resp (p_tok IN VARCHAR2, p_post IN VARCHAR2, p_choice IN VARCHAR2, p_note IN VARCHAR2) AS " +
        "v_id VARCHAR2(40); v_company VARCHAR2(200); v_name VARCHAR2(360); v_acct VARCHAR2(60); v_date VARCHAR2(10); v_cur VARCHAR2(10); v_bal NUMBER; v_bu VARCHAR2(30); v_resp VARCHAR2(20); v_at DATE; v_ua VARCHAR2(400); v_choice VARCHAR2(20); " +
        "PROCEDURE page (p_body IN VARCHAR2) IS BEGIN OWA_UTIL.mime_header('text/html', FALSE, 'UTF-8'); HTP.p('Cache-Control: no-store'); OWA_UTIL.http_header_close; " +
        "HTP.p('<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Statement of account</title><style>body{margin:0;font:15px/1.5 \"Segoe UI\",Arial,sans-serif;background:#eef2f7;color:#0f172a}.c{max-width:560px;margin:7vh auto;background:#fff;border-radius:14px;padding:30px 34px;box-shadow:0 10px 30px rgba(15,23,42,.1)}h1{font-size:21px;margin:0 0 4px}.m{color:#64748b;font-size:13px}.bal{font-size:26px;font-weight:700;margin:14px 0}textarea{width:100%;box-sizing:border-box;min-height:90px;border:1px solid #cbd5e1;border-radius:8px;padding:10px;font:inherit}.b{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}button{border:0;border-radius:9px;padding:12px 18px;font:inherit;font-weight:700;cursor:pointer;color:#fff}.ag{background:#15803d}.di{background:#b45309}.ok{color:#15803d;font-weight:700;font-size:17px}.f{margin-top:22px;font-size:12px;color:#94a3b8}</style></head><body><div class=\"c\">'); " +
        "HTP.p(p_body); HTP.p('<div class=\"f\">' || HTF.escape_sc(v_company) || ' · Accounts Receivable</div></div></body></html>'); END; " +
        "BEGIN BEGIN v_ua := SUBSTR(OWA_UTIL.get_cgi_env('HTTP_USER_AGENT'), 1, 400); EXCEPTION WHEN OTHERS THEN v_ua := NULL; END; " +
        "BEGIN SELECT stmt_id, company, account_name, account_number, stmt_date, currency, balance, bu_id, resp_status, resp_at INTO v_id, v_company, v_name, v_acct, v_date, v_cur, v_bal, v_bu, v_resp, v_at FROM wms_dc_stmts WHERE token = p_tok AND LENGTH(p_tok) >= 16; " +
        "EXCEPTION WHEN NO_DATA_FOUND THEN page('<h1>This link is not valid</h1><p class=\"m\">It may have been copied incompletely. Please use the button in the e-mail.</p>'); RETURN; END; " +
        "v_choice := CASE UPPER(p_choice) WHEN 'AGREE' THEN 'AGREED' WHEN 'DISPUTE' THEN 'DISPUTED' ELSE NULL END; " +
        "IF p_post = 'Y' AND v_resp IS NULL AND v_choice IS NOT NULL THEN " +
        "UPDATE wms_dc_stmts SET resp_status = v_choice, resp_comment = SUBSTR(p_note, 1, 2000), resp_at = SYSDATE, resp_agent = v_ua, opens = GREATEST(NVL(opens, 0), 1), first_open = NVL(first_open, SYSDATE) WHERE stmt_id = v_id; " +
        "INSERT INTO wms_dc_activity (act_id, bu_id, account_number, account_name, kind, subject, body, amount, status, ref_id, source, created_by, created_at) VALUES ('cu' || LOWER(RAWTOHEX(SYS_GUID())), v_bu, v_acct, v_name, CASE v_choice WHEN 'AGREED' THEN 'CONFIRM' ELSE 'DISPUTE' END, " +
        "CASE v_choice WHEN 'AGREED' THEN 'Customer agreed the balance as at ' || v_date ELSE 'Customer disputes the balance as at ' || v_date END, SUBSTR(p_note, 1, 4000), v_bal, CASE v_choice WHEN 'AGREED' THEN 'DONE' ELSE 'OPEN' END, v_id, 'CUSTOMER', 'customer', SYSDATE); " +
        "COMMIT; v_resp := v_choice; v_at := SYSDATE; END IF; " +
        "IF v_resp IS NULL THEN page('<div class=\"m\">' || HTF.escape_sc(v_company) || '</div><h1>Statement of account as at ' || HTF.escape_sc(v_date) || '</h1><p class=\"m\">' || HTF.escape_sc(v_name) || ' · account ' || HTF.escape_sc(v_acct) || '</p><div class=\"bal\">' || HTF.escape_sc(v_cur) || ' ' || TO_CHAR(v_bal, 'FM999G999G999G990D00') || '</div>' || " +
        "'<form method=\"post\"><p>Does this balance agree with your records?</p><textarea name=\"note\" maxlength=\"2000\" placeholder=\"Optional: tell us what differs (invoice numbers, payments, credit notes …)\"></textarea><div class=\"b\"><button class=\"ag\" type=\"submit\" name=\"choice\" value=\"AGREE\">&#10003; Yes, I agree with the balance</button><button class=\"di\" type=\"submit\" name=\"choice\" value=\"DISPUTE\">I want to query this balance</button></div></form>'); " +
        "ELSE page('<div class=\"m\">' || HTF.escape_sc(v_company) || '</div><h1>Statement of account as at ' || HTF.escape_sc(v_date) || '</h1><p class=\"ok\">&#10003; Thank you — ' || CASE v_resp WHEN 'AGREED' THEN 'you agreed the balance' ELSE 'your query has been passed to our accounts team' END || '</p><p class=\"m\">' || HTF.escape_sc(v_name) || ' · ' || TO_CHAR(v_at, 'DD Mon YYYY HH24:MI') || '</p>'); END IF; END wms_dc_resp;";
    var ORDS_SETUP = "DECLARE v_module VARCHAR2(200); BEGIN SELECT name INTO v_module FROM user_ords_modules WHERE UPPER(uri_prefix) LIKE '%WAREHOUSEMANAGEMENT%' AND ROWNUM = 1; " +
        "ORDS.DEFINE_TEMPLATE(p_module_name => v_module, p_pattern => 'dc/px/:tok'); ORDS.DEFINE_HANDLER(p_module_name => v_module, p_pattern => 'dc/px/:tok', p_method => 'GET', p_source_type => ORDS.source_type_plsql, p_source => 'BEGIN wms_dc_px(:tok); END;'); " +
        "ORDS.DEFINE_TEMPLATE(p_module_name => v_module, p_pattern => 'dc/resp/:tok'); ORDS.DEFINE_HANDLER(p_module_name => v_module, p_pattern => 'dc/resp/:tok', p_method => 'GET', p_source_type => ORDS.source_type_plsql, p_source => 'BEGIN wms_dc_resp(:tok, ''N'', NULL, NULL); END;'); " +
        "ORDS.DEFINE_HANDLER(p_module_name => v_module, p_pattern => 'dc/resp/:tok', p_method => 'POST', p_source_type => ORDS.source_type_plsql, p_source => 'BEGIN wms_dc_resp(:tok, ''Y'', :choice, :note); END;'); COMMIT; END;";
    S.respUrl = function (tok) { return S.PUBLIC + '/dc/resp/' + tok; };
    /** Do the customer links answer? (a made-up token must say "not valid") */
    S.linksCheck = function () {
        return S.get(S.respUrl('0000000000000000'), 30000).then(function (r) { S.linksOk = /not valid/i.test(r.text || ''); return S.linksOk; }).catch(function () { S.linksOk = false; return false; });
    };
    S.linksSetup = function () {
        return S.ensure().then(function () { return S.write(PX); }).then(function () { return S.write(S.RESP_SQL); }).then(function () { return S.write(ORDS_SETUP); }).then(S.linksCheck);
    };
})(window);
