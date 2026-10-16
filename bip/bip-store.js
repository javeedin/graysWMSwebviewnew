/* Oracle BIP Reporting · host bridge + APEX layer (window.BIPS).
 * The host (classes/Form1_BipHandlers.cs) does everything that touches the pod: catalog, parameters, runs (reply bipResponse,
 * live bipProgress). APEX keeps what is shared through the ai/executequery | executewrite gateway: dashboards, favourites,
 * notes per report, the run log and the CATALOG (WMS_BIP_CATALOG: every folder read and every index walk, so another user's
 * first open is instant — this PC's DuckDB copy is asked first, APEX second, Fusion last) (apex_sql/98_bip_reporting.sql, created here on first use). CLOBs follow the Field Apps
 * rules: literals ≤ 1,000 chars / 3,800 bytes, reads as 600-char columns of one query, both checked against LENGTH(). */
(function (root) {
    'use strict';
    var S = root.BIPS = {};
    S.ORDS = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP';
    S.GW = S.ORDS + '/WAREHOUSEMANAGEMENT/ai';
    S.user = function () { try { return (localStorage.getItem('wms_user') || sessionStorage.getItem('loggedInUser') || localStorage.getItem('loggedInUser') || localStorage.getItem('username') || 'UNKNOWN').trim(); } catch (e) { return 'UNKNOWN'; } };
    S.loginPod = function () { try { return (sessionStorage.getItem('loggedInInstance') || localStorage.getItem('fusionInstance') || localStorage.getItem('instanceName') || 'PROD').toUpperCase(); } catch (e) { return 'PROD'; } };

    // ── host bridge ───────────────────────────────────────────────
    var pending = {}, progress = {};
    S.hasHost = function () { return !!(window.chrome && window.chrome.webview); };
    S.host = function (action, payload, ms, onProgress) {
        return new Promise(function (resolve, reject) {
            if (!S.hasHost()) { reject(new Error('Open this page inside the Gray\'s WMS app.')); return; }
            var id = 'bip_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
            pending[id] = { resolve: resolve, reject: reject };
            if (onProgress) progress[id] = onProgress;
            window.chrome.webview.postMessage(Object.assign({ action: action, requestId: id, appUser: S.user() }, payload || {}));
            if (ms !== 0) setTimeout(function () { if (pending[id]) { delete pending[id]; delete progress[id]; reject(new Error(action + ' timed out')); } }, ms || 120000);
        });
    };
    if (S.hasHost()) window.chrome.webview.addEventListener('message', function (ev) {
        var r = ev.data; if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { return; } }
        if (!r || !r.requestId) return;
        if (r.action === 'bipProgress') { var fn = progress[r.requestId]; if (fn) { try { fn(r.data || {}); } catch (e) { } } return; }
        if (!pending[r.requestId]) return;
        var cb = pending[r.requestId]; delete pending[r.requestId]; delete progress[r.requestId];
        if (r.action === 'error') cb.reject(new Error((r.data && r.data.message) || r.message || 'Host error'));
        else if (r.action === 'restResponse') cb.resolve({ rest: true, ok: r.success !== false, status: r.statusCode, text: r.data });
        else cb.resolve(r.data == null ? r : r.data);
    });
    /** A bip* host action → its data; { ok: false } becomes an Error. */
    S.bip = function (action, payload, ms, onProgress) {
        return S.host(action, payload, ms, onProgress).then(function (d) { if (d && d.ok === false) { var e = new Error(d.error || action + ' failed'); e.data = d; throw e; } return d; });
    };
    S.get = function (url, ms) { return S.host('executeGet', { fullUrl: url }, ms || 120000).then(restOut); };
    S.post = function (url, body, ms) { return S.host('executePost', { fullUrl: url, body: typeof body === 'string' ? body : JSON.stringify(body || {}) }, ms || 120000).then(restOut); };
    function restOut(r) { var o = { ok: !!(r && r.ok), status: r && r.status, text: r && r.text, json: null }; try { o.json = JSON.parse(o.text); } catch (e) { } return o; }

    // ── gateway ───────────────────────────────────────────────────
    S.call = function (op, payload) {
        return S.post(S.GW + '/' + op, Object.assign({ appUser: S.user() }, payload)).then(function (r) {
            var d = r.json;
            if (!d) throw new Error('Unexpected answer from the database API' + (r.status ? ' (HTTP ' + r.status + ')' : ''));
            if (d.success === false) throw new Error(d.error || d.message || 'Database API error');
            return d;
        });
    };
    S.rows = function (sql, max) {
        return S.call('executequery', { sql: sql, maxRows: Math.min(max || 500, 1000) }).then(function (d) {
            var cols = (d.columns || []).map(function (c) { return String(c.name || c).toUpperCase(); });
            return (d.rows || []).map(function (r) {
                if (!Array.isArray(r)) { var o = {}; Object.keys(r).forEach(function (k) { o[k.toUpperCase()] = r[k]; }); return o; }
                var x = {}; cols.forEach(function (c, i) { x[c] = r[i]; }); return x;
            });
        });
    };
    S.write = function (sql) { return S.call('executewrite', { sql: sql }); };
    /** Every row of a query (the gateway answers 1,000 at a time): sql must end with ORDER BY … */
    S.rowsAll = function (sql, max) {
        var out = [], page = 1000, limit = max || 100000;
        function next(off) { return S.rows(sql + ' OFFSET ' + off + ' ROWS FETCH NEXT ' + page + ' ROWS ONLY', page).then(function (r) { out = out.concat(r); if (r.length < page || out.length >= limit) return out; return next(off + page); }); }
        return next(0);
    };
    S.likeEsc = function (s) { return String(s == null ? '' : s).replace(/[\\%_]/g, function (c) { return '\\' + c; }); };
    S.lit = function (s, max) { if (s == null || s === '') return 'NULL'; s = String(s); if (max && s.length > max) { s = s.slice(0, max); if (/[\uD800-\uDBFF]$/.test(s)) s = s.slice(0, -1); } return "'" + s.replace(/'/g, "''") + "'"; };
    S.num = function (n) { if (n == null || n === '' || isNaN(+n)) return 'NULL'; return String(+n); };
    S.CLOB_READ = 600; S.CLOB_WRITE = 1000; S.CLOB_WRITE_BYTES = 3800; S.CLOB_COLS = 200;
    S.cpLen = function (s) { s = String(s == null ? '' : s); var pairs = s.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g); return s.length - (pairs ? pairs.length : 0); };
    S.pieces = function (s, chars, bytes, dq) {
        s = String(s == null ? '' : s); var out = [], i = 0, n = s.length;
        while (i < n) {
            var j = i, cp = 0, b = 0;
            while (j < n && cp < chars) {
                var c = s.charCodeAt(j), w = 1, cb;
                if (c >= 0xD800 && c <= 0xDBFF && j + 1 < n && (s.charCodeAt(j + 1) & 0xFC00) === 0xDC00) { w = 2; cb = 4; } else cb = c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
                if (dq && c === 39) cb = 2;
                if (bytes && b + cb > bytes && cp > 0) break;
                j += w; cp++; b += cb;
            }
            out.push(s.slice(i, j)); i = j;
        }
        return out;
    };
    S.writeClob = function (table, col, where, text) {
        text = text == null ? '' : String(text);
        var pieces = S.pieces(text, S.CLOB_WRITE, S.CLOB_WRITE_BYTES, true), groups = [];
        for (var i = 0; i < pieces.length; i += 16) groups.push(pieces.slice(i, i + 16));
        return S.write('UPDATE ' + table + ' SET ' + col + ' = EMPTY_CLOB() WHERE ' + where).then(function () {
            return groups.reduce(function (p, g) { return p.then(function () { return S.write('UPDATE ' + table + ' SET ' + col + ' = ' + col + ' || ' + g.map(function (x) { return "TO_CLOB('" + x.replace(/'/g, "''") + "')"; }).join(' || ') + ' WHERE ' + where); }); }, Promise.resolve());
        }).then(function () { return S.rows('SELECT NVL(LENGTH(' + col + '), 0) AS L FROM ' + table + ' WHERE ' + where, 2); }).then(function (r) {
            var want = S.cpLen(text), got = r.length ? +r[0].L || 0 : -1;
            if (got !== want) throw new Error('APEX kept ' + got + ' characters of the ' + want + ' written to ' + table + '.' + col);
            return want;
        });
    };
    S.readClob = function (table, col, keyCol, ids) {
        var piece = S.CLOB_READ, out = {}, lens = {};
        if (!ids.length) return Promise.resolve(out);
        var where = ' WHERE ' + keyCol + ' IN (' + ids.map(function (i) { return S.lit(i); }).join(', ') + ')';
        return S.rows('SELECT ' + keyCol + ' AS K, NVL(LENGTH(' + col + '), 0) AS L FROM ' + table + where, 1000).then(function (r) {
            var max = 0; r.forEach(function (x) { out[x.K] = ''; lens[x.K] = +x.L || 0; max = Math.max(max, lens[x.K]); });
            var calls = []; for (var p = 1; p <= max; p += piece * S.CLOB_COLS) calls.push(p);
            return calls.reduce(function (pr, p0) {
                return pr.then(function () {
                    var cols = []; for (var k = 0; k < S.CLOB_COLS && p0 + k * piece <= max; k++) cols.push('TO_CHAR(SUBSTR(' + col + ', ' + (p0 + k * piece) + ', ' + piece + ')) AS P' + k);
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
        WMS_BIP_DASHBOARDS: "CREATE TABLE wms_bip_dashboards (dash_id VARCHAR2(40) PRIMARY KEY, name VARCHAR2(200), owner VARCHAR2(100), shared VARCHAR2(1) DEFAULT 'Y', pod VARCHAR2(20), def_json CLOB, created_date DATE DEFAULT SYSDATE, changed_by VARCHAR2(100), changed_date DATE)",
        WMS_BIP_FAVORITES: "CREATE TABLE wms_bip_favorites (username VARCHAR2(100), pod VARCHAR2(20), report_path VARCHAR2(1000), display_name VARCHAR2(400), added_date DATE DEFAULT SYSDATE, PRIMARY KEY (username, pod, report_path))",
        WMS_BIP_REPORT_NOTES: "CREATE TABLE wms_bip_report_notes (pod VARCHAR2(20), report_path VARCHAR2(1000), notes VARCHAR2(4000), tags VARCHAR2(400), changed_by VARCHAR2(100), changed_date DATE, PRIMARY KEY (pod, report_path))",
        WMS_BIP_RUN_LOG: "CREATE TABLE wms_bip_run_log (log_id VARCHAR2(40) PRIMARY KEY, pod VARCHAR2(20), report_path VARCHAR2(1000), display_name VARCHAR2(400), app_user VARCHAR2(100), pc_name VARCHAR2(100), run_id VARCHAR2(60), format VARCHAR2(20), buckets NUMBER, rows_n NUMBER, bytes_n NUMBER, ms NUMBER, status VARCHAR2(20), error_text VARCHAR2(2000), params_json VARCHAR2(4000), run_date DATE DEFAULT SYSDATE)",
        WMS_BIP_CATALOG: "CREATE TABLE wms_bip_catalog (pod VARCHAR2(20), item_path VARCHAR2(1000), display_name VARCHAR2(400), file_name VARCHAR2(400), item_type VARCHAR2(40), parent_path VARCHAR2(1000), last_modified VARCHAR2(40), owner_name VARCHAR2(200), read_by VARCHAR2(100), read_date DATE DEFAULT SYSDATE, PRIMARY KEY (pod, item_path))",
        WMS_BIP_CATALOG_LOG: "CREATE TABLE wms_bip_catalog_log (pod VARCHAR2(20), root_path VARCHAR2(1000), folders NUMBER, reports NUMBER, items NUMBER, ms NUMBER, read_by VARCHAR2(100), read_date DATE DEFAULT SYSDATE, index_mode VARCHAR2(10))"
    };
    var ensured = null;
    S.ensure = function () {
        if (ensured) return ensured;
        ensured = S.rows("SELECT table_name AS T FROM user_tables WHERE table_name IN ('WMS_BIP_DASHBOARDS','WMS_BIP_FAVORITES','WMS_BIP_REPORT_NOTES','WMS_BIP_RUN_LOG','WMS_BIP_CATALOG','WMS_BIP_CATALOG_LOG')", 20).then(function (r) {
            var have = {}; r.forEach(function (x) { have[String(x.T).toUpperCase()] = 1; });
            var missing = Object.keys(S.DDL).filter(function (t) { return !have[t]; });
            return missing.reduce(function (p, t) { return p.then(function () { return S.write(S.DDL[t]).catch(function (e) { if (!/ORA-00955/.test(e.message)) throw e; }); }); }, Promise.resolve())
                .then(function () { if (!have.WMS_BIP_CATALOG_LOG) return; return S.write('ALTER TABLE wms_bip_catalog_log ADD index_mode VARCHAR2(10)').catch(function () { }); })   // a log table made before the column existed
                .then(function () { return { created: missing, have: Object.keys(have) }; });
        }).catch(function (e) { ensured = null; throw e; });
        return ensured;
    };

    // ── dashboards ────────────────────────────────────────────────
    S.dash = {
        list: function (pod) {
            return S.ensure().then(function () {
                return S.rows("SELECT dash_id AS ID, name AS NAME, owner AS OWNER, shared AS SHARED, pod AS POD, TO_CHAR(changed_date, 'YYYY-MM-DD\"T\"HH24:MI') AS CHANGED, changed_by AS CHANGED_BY, NVL(LENGTH(def_json), 0) AS LEN FROM wms_bip_dashboards WHERE (shared = 'Y' OR owner = " + S.lit(S.user()) + ")" + (pod ? " AND (pod = " + S.lit(pod) + " OR pod IS NULL)" : '') + ' ORDER BY name', 500);
            });
        },
        get: function (id) { return S.readClob('wms_bip_dashboards', 'def_json', 'dash_id', [id]).then(function (m) { try { return JSON.parse(m[id] || 'null'); } catch (e) { return null; } }); },
        save: function (d) {
            var me = S.lit(S.user()), id = d.id, json = JSON.stringify(d);
            return S.ensure().then(function () {
                return S.write('MERGE INTO wms_bip_dashboards t USING (SELECT ' + S.lit(id) + ' AS dash_id FROM dual) s ON (t.dash_id = s.dash_id) WHEN MATCHED THEN UPDATE SET name = ' + S.lit(d.name, 200) + ', shared = ' + S.lit(d.shared === false ? 'N' : 'Y') + ', pod = ' + S.lit(d.pod, 20) + ', changed_by = ' + me + ', changed_date = SYSDATE' +
                    ' WHEN NOT MATCHED THEN INSERT (dash_id, name, owner, shared, pod, def_json, created_date, changed_by, changed_date) VALUES (' + S.lit(id) + ', ' + S.lit(d.name, 200) + ', ' + me + ', ' + S.lit(d.shared === false ? 'N' : 'Y') + ', ' + S.lit(d.pod, 20) + ', EMPTY_CLOB(), SYSDATE, ' + me + ', SYSDATE)');
            }).then(function () { return S.writeClob('wms_bip_dashboards', 'def_json', 'dash_id = ' + S.lit(id), json); });
        },
        del: function (id) { return S.write('DELETE FROM wms_bip_dashboards WHERE dash_id = ' + S.lit(id)); }
    };

    // ── favourites, notes, run log ───────────────────────────────
    S.fav = {
        list: function (pod) { return S.ensure().then(function () { return S.rows('SELECT report_path AS P, display_name AS N FROM wms_bip_favorites WHERE username = ' + S.lit(S.user()) + ' AND pod = ' + S.lit(pod) + ' ORDER BY display_name', 500); }); },
        add: function (pod, path, name) { return S.ensure().then(function () { return S.write('INSERT INTO wms_bip_favorites (username, pod, report_path, display_name) SELECT ' + S.lit(S.user()) + ', ' + S.lit(pod) + ', ' + S.lit(path, 1000) + ', ' + S.lit(name, 400) + ' FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_bip_favorites WHERE username = ' + S.lit(S.user()) + ' AND pod = ' + S.lit(pod) + ' AND report_path = ' + S.lit(path, 1000) + ')'); }); },
        remove: function (pod, path) { return S.write('DELETE FROM wms_bip_favorites WHERE username = ' + S.lit(S.user()) + ' AND pod = ' + S.lit(pod) + ' AND report_path = ' + S.lit(path, 1000)); }
    };
    S.notes = {
        get: function (pod, path) { return S.ensure().then(function () { return S.rows('SELECT notes AS N, tags AS T, changed_by AS CHANGED_BY, TO_CHAR(changed_date, \'YYYY-MM-DD HH24:MI\') AS AT FROM wms_bip_report_notes WHERE pod = ' + S.lit(pod) + ' AND report_path = ' + S.lit(path, 1000), 1).then(function (r) { return r[0] || null; }); }); },
        save: function (pod, path, notes, tags) {
            return S.ensure().then(function () {
                return S.write('MERGE INTO wms_bip_report_notes t USING (SELECT ' + S.lit(pod) + ' AS pod, ' + S.lit(path, 1000) + ' AS report_path FROM dual) s ON (t.pod = s.pod AND t.report_path = s.report_path) WHEN MATCHED THEN UPDATE SET notes = ' + S.lit(notes, 4000) + ', tags = ' + S.lit(tags, 400) + ', changed_by = ' + S.lit(S.user()) + ', changed_date = SYSDATE WHEN NOT MATCHED THEN INSERT (pod, report_path, notes, tags, changed_by, changed_date) VALUES (' + S.lit(pod) + ', ' + S.lit(path, 1000) + ', ' + S.lit(notes, 4000) + ', ' + S.lit(tags, 400) + ', ' + S.lit(S.user()) + ', SYSDATE)');
            });
        },
        all: function (pod) { return S.ensure().then(function () { return S.rows('SELECT report_path AS P, notes AS N, tags AS T FROM wms_bip_report_notes WHERE pod = ' + S.lit(pod), 1000); }); }
    };
    // ── the catalog, shared ───────────────────────────────────────
    var CAT_COLS = 'item_path AS P, display_name AS N, file_name AS F, item_type AS T, parent_path AS PP, last_modified AS M, owner_name AS O';
    function catItem(r) { return { absolutePath: r.P, displayName: r.N, fileName: r.F, type: r.T, parentAbsolutePath: r.PP || S.parentOf(r.P), lastModified: r.M, owner: r.O }; }
    // The parent folder of a catalog path — BI Publisher sends a blank parentAbsolutePath for the children of "/".
    S.parentOf = function (path) {
        var t = String(path || '');
        if (t.length > 1) t = t.replace(/\/+$/, '');
        var i = t.lastIndexOf('/');
        return i <= 0 ? '/' : t.substring(0, i);
    };
    function normFolder(path) { var p = String(path || '/'); return p.length > 1 ? p.replace(/\/+$/, '') : p; }
    // a row is in the folder when its parent says so, or (no parent kept) its own path sits directly under the folder
    function inFolder(path) {
        var p = normFolder(path), pre = S.likeEsc(p === '/' ? '/' : p + '/');
        return '(parent_path = ' + S.lit(p, 1000) + ' OR (parent_path IS NULL AND item_path LIKE ' + S.lit(pre + '%', 1000) + " ESCAPE '\\' AND item_path NOT LIKE " + S.lit(pre + '%/_%', 1000) + " ESCAPE '\\'))";
    }
    function catInsert(pod, items) {
        var me = S.lit(S.user()), groups = [];
        for (var i = 0; i < items.length; i += 40) groups.push(items.slice(i, i + 40));
        return groups.reduce(function (p, g) {
            return p.then(function () {
                return S.write('DELETE FROM wms_bip_catalog WHERE pod = ' + S.lit(pod) + ' AND item_path IN (' + g.map(function (it) { return S.lit(it.absolutePath, 1000); }).join(', ') + ')').then(function () {
                    return S.write('INSERT INTO wms_bip_catalog (pod, item_path, display_name, file_name, item_type, parent_path, last_modified, owner_name, read_by) ' + g.map(function (it) { return 'SELECT ' + [S.lit(pod, 20), S.lit(it.absolutePath, 1000), S.lit(it.displayName, 400), S.lit(it.fileName, 400), S.lit(it.type, 40), S.lit(it.parentAbsolutePath ? normFolder(it.parentAbsolutePath) : S.parentOf(it.absolutePath), 1000), S.lit(it.lastModified, 40), S.lit(it.owner, 200), me].join(', ') + ' FROM dual'; }).join(' UNION ALL '));
                });
            });
        }, Promise.resolve());
    }
    S.catalog = {
        /** One folder as another user kept it → { items, at, by } (items empty = not in APEX). */
        folder: function (pod, path) {
            return S.ensure().then(function () { return S.rows('SELECT ' + CAT_COLS + ", TO_CHAR(read_date, 'YYYY-MM-DD HH24:MI') AS AT, read_by AS RB FROM wms_bip_catalog WHERE pod = " + S.lit(pod) +  ' AND ' + inFolder(path) + ' AND item_path <> ' + S.lit(normFolder(path), 1000) + " ORDER BY CASE WHEN item_type = 'Folder' THEN 0 ELSE 1 END, lower(display_name)", 1000); })
                .then(function (r) { return { items: r.map(catItem), at: r.length ? r[0].AT : null, by: r.length ? r[0].RB : null }; });
        },
        saveFolder: function (pod, path, items) {
            return S.ensure().then(function () { return S.write('DELETE FROM wms_bip_catalog WHERE pod = ' + S.lit(pod) + ' AND ' + inFolder(path) + ' AND item_path <> ' + S.lit(normFolder(path), 1000)); }).then(function () { return catInsert(pod, items || []); });
        },
        /** The whole catalog as last indexed by anyone → { items, at, by, root, folders, reports }; items empty when nobody indexed this pod. */
        index: function (pod) {
            return S.ensure().then(function () { return S.rows("SELECT root_path AS R, folders AS FO, reports AS RE, items AS I, ms AS MS, read_by AS RB, index_mode AS IM, TO_CHAR(read_date, 'YYYY-MM-DD HH24:MI') AS AT FROM wms_bip_catalog_log WHERE pod = " + S.lit(pod) + ' ORDER BY read_date DESC FETCH FIRST 1 ROWS ONLY', 1); })
                .then(function (log) {
                    if (!log.length) return { items: [], at: null };
                    var l = log[0];
                    return S.rowsAll('SELECT ' + CAT_COLS + ' FROM wms_bip_catalog WHERE pod = ' + S.lit(pod) + ' ORDER BY item_path').then(function (r) { return { items: r.map(catItem), at: l.AT, by: l.RB, mode: l.IM || 'FULL', root: l.R || '/', folders: +l.FO || 0, reports: +l.RE || 0, ms: +l.MS || 0 }; });
                });
        },
        /** The latest index log row alone (when / who / how) — for the search popup's footer. */
        log: function (pod) {
            return S.ensure().then(function () { return S.rows("SELECT root_path AS R, folders AS FO, reports AS RE, items AS I, read_by AS RB, index_mode AS IM, TO_CHAR(read_date, 'YYYY-MM-DD HH24:MI') AS AT FROM wms_bip_catalog_log WHERE pod = " + S.lit(pod) + ' ORDER BY read_date DESC FETCH FIRST 1 ROWS ONLY', 1); }).then(function (r) { return r[0] ? { at: r[0].AT, by: r[0].RB, mode: r[0].IM || 'FULL', folders: +r[0].FO || 0, reports: +r[0].RE || 0, items: +r[0].I || 0 } : null; });
        },
        /** After an UPDATE walk: only what changed since the last index goes to APEX (upserts + removed paths) + a log row. */
        saveDelta: function (pod, root, upserts, removedPaths, info) {
            info = info || {}; removedPaths = removedPaths || [];
            return S.ensure().then(function () {
                var groups = []; for (var i = 0; i < removedPaths.length; i += 100) groups.push(removedPaths.slice(i, i + 100));
                return groups.reduce(function (p, g) { return p.then(function () { return S.write('DELETE FROM wms_bip_catalog WHERE pod = ' + S.lit(pod) + ' AND item_path IN (' + g.map(function (x) { return S.lit(x, 1000); }).join(', ') + ')'); }); }, Promise.resolve());
            }).then(function () { return catInsert(pod, upserts || []); }).then(function () {
                return S.write('INSERT INTO wms_bip_catalog_log (pod, root_path, folders, reports, items, ms, read_by, index_mode) VALUES (' + [S.lit(pod, 20), S.lit(root || '/', 1000), S.num(info.folders), S.num(info.reports), S.num(info.items), S.num(info.ms), S.lit(S.user()), S.lit('UPDATE')].join(', ') + ')');
            });
        },
        saveIndex: function (pod, root, items, folders, reports, ms) {
            root = root || '/';
            return S.ensure().then(function () {
                return S.write('DELETE FROM wms_bip_catalog WHERE pod = ' + S.lit(pod) + (root === '/' ? '' : ' AND (item_path = ' + S.lit(root, 1000) + " OR item_path LIKE " + S.lit(S.likeEsc(root) + '/%', 1000) + " ESCAPE '\\')"));
            }).then(function () { return catInsert(pod, items || []); }).then(function () {
                return S.write('INSERT INTO wms_bip_catalog_log (pod, root_path, folders, reports, items, ms, read_by, index_mode) VALUES (' + [S.lit(pod, 20), S.lit(root, 1000), S.num(folders), S.num(reports), S.num((items || []).length), S.num(ms), S.lit(S.user()), S.lit('FULL')].join(', ') + ')');
            });
        }
    };
    S.runLog = {
        add: function (e) {
            var id = 'rl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
            return S.ensure().then(function () {
                return S.write('INSERT INTO wms_bip_run_log (log_id, pod, report_path, display_name, app_user, pc_name, run_id, format, buckets, rows_n, bytes_n, ms, status, error_text, params_json) VALUES (' + [S.lit(id), S.lit(e.pod, 20), S.lit(e.path, 1000), S.lit(e.name, 400), S.lit(S.user()), S.lit(e.pc, 100), S.lit(e.runId, 60), S.lit(e.format, 20), S.num(e.buckets), S.num(e.rows), S.num(e.bytes), S.num(e.ms), S.lit(e.status, 20), S.lit(e.error, 2000), S.lit(e.params, 4000)].join(', ') + ')');
            }).catch(function (x) { console.warn('[BIP] run log', x.message); });
        },
        recent: function (pod, n) { return S.ensure().then(function () { return S.rows("SELECT report_path AS P, display_name AS N, app_user AS U, pc_name AS PC, run_id AS R, format AS F, buckets AS B, rows_n AS ROWS_N, bytes_n AS BYTES_N, ms AS MS, status AS S, error_text AS E, TO_CHAR(run_date, 'YYYY-MM-DD HH24:MI') AS AT FROM wms_bip_run_log WHERE pod = " + S.lit(pod) + ' ORDER BY run_date DESC FETCH FIRST ' + (n || 100) + ' ROWS ONLY', n || 100); }); },
        popular: function (pod, days) { return S.ensure().then(function () { return S.rows('SELECT report_path AS P, MAX(display_name) AS N, COUNT(*) AS RUNS, COUNT(DISTINCT app_user) AS USERS, MAX(run_date) AS LAST_RUN, ROUND(AVG(ms)) AS AVG_MS, MAX(rows_n) AS MAX_ROWS FROM wms_bip_run_log WHERE pod = ' + S.lit(pod) + ' AND run_date >= SYSDATE - ' + (days || 90) + ' GROUP BY report_path ORDER BY COUNT(*) DESC FETCH FIRST 30 ROWS ONLY', 30); }); }
    };
})(window);
