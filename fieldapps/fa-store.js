/* Field Apps · APEX layer of the desktop page (window.FAS).
 * Everything the page keeps lives in APEX through the ai/executequery | executewrite gateway (one statement per call,
 * CLOBs written in TO_CLOB pieces and read back as TO_CHAR(SUBSTR()) columns, both checked against LENGTH()); the phones use the ORDS handlers of
 * apex_sql/97_field_apps.sql instead. Host actions go through this page's own postMessage bridge (no app.js here). */
(function (root) {
    'use strict';
    var FAS = root.FAS = {};
    FAS.ORDS = 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP';
    FAS.WM = FAS.ORDS + '/WAREHOUSEMANAGEMENT';
    FAS.GW = FAS.WM + '/ai';
    FAS.user = function () { try { return (localStorage.getItem('wms_user') || sessionStorage.getItem('loggedInUser') || localStorage.getItem('loggedInUser') || localStorage.getItem('username') || 'UNKNOWN').trim(); } catch (e) { return 'UNKNOWN'; } };
    FAS.pod = function () { try { return (sessionStorage.getItem('loggedInInstance') || localStorage.getItem('fusionInstance') || localStorage.getItem('instanceName') || 'PROD').toUpperCase(); } catch (e) { return 'PROD'; } };

    // ── host bridge ───────────────────────────────────────────────
    var pending = {};
    FAS.hasHost = function () { return !!(window.chrome && window.chrome.webview); };
    FAS.host = function (action, payload, ms) {
        return new Promise(function (resolve, reject) {
            if (!FAS.hasHost()) { reject(new Error('Open this page inside the Gray\'s WMS app.')); return; }
            var id = 'fa_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
            pending[id] = { resolve: resolve, reject: reject };
            window.chrome.webview.postMessage(Object.assign({ action: action, requestId: id, appUser: FAS.user() }, payload || {}));
            setTimeout(function () { if (pending[id]) { delete pending[id]; reject(new Error(action + ' timed out')); } }, ms || 120000);
        });
    };
    if (FAS.hasHost()) window.chrome.webview.addEventListener('message', function (ev) {
        var r = ev.data; if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { return; } }
        if (!r || !r.requestId || !pending[r.requestId]) return;
        var cb = pending[r.requestId]; delete pending[r.requestId];
        if (r.action === 'error') cb.reject(new Error((r.data && r.data.message) || r.message || 'Host error'));
        else if (r.action === 'restResponse') cb.resolve({ rest: true, ok: r.success !== false, status: r.statusCode, text: r.data });
        else cb.resolve(r.data == null ? r : r.data);
    });
    FAS.hostOk = function (action, payload, ms) { return FAS.host(action, payload, ms).then(function (d) { if (d && d.ok === false) throw new Error(d.error || 'Failed'); return d; }); };
    /** executeGet / executePost → { ok, status, text, json } */
    FAS.get = function (url, ms) { return FAS.host('executeGet', { fullUrl: url }, ms || 120000).then(restOut); };
    FAS.post = function (url, body, ms) { return FAS.host('executePost', { fullUrl: url, body: typeof body === 'string' ? body : JSON.stringify(body || {}) }, ms || 120000).then(restOut); };
    function restOut(r) { var o = { ok: !!(r && r.ok), status: r && r.status, text: r && r.text, json: null }; try { o.json = JSON.parse(o.text); } catch (e) { } return o; }

    // ── gateway ───────────────────────────────────────────────────
    FAS.call = function (op, payload) {
        return FAS.post(FAS.GW + '/' + op, Object.assign({ appUser: FAS.user() }, payload)).then(function (r) {
            var d = r.json;
            if (!d) throw new Error('Unexpected answer from the database API' + (r.status ? ' (HTTP ' + r.status + ')' : ''));
            if (d.success === false) throw new Error(d.error || d.message || 'Database API error');
            return d;
        });
    };
    FAS.rows = function (sql, max) {
        return FAS.call('executequery', { sql: sql, maxRows: Math.min(max || 500, 1000) }).then(function (d) {
            var cols = (d.columns || []).map(function (c) { return String(c.name || c).toUpperCase(); });
            return (d.rows || []).map(function (r) {
                if (!Array.isArray(r)) { var o = {}; Object.keys(r).forEach(function (k) { o[k.toUpperCase()] = r[k]; }); return o; }
                var x = {}; cols.forEach(function (c, i) { x[c] = r[i]; }); return x;
            });
        });
    };
    /** Every row of a query (the gateway caps one call at 1,000): pages of 1,000 with OFFSET / FETCH, up to max. */
    FAS.rowsAll = function (sql, max) {
        max = max || 20000; var out = [];
        function page(off) {
            return FAS.rows('SELECT * FROM (' + sql + ') OFFSET ' + off + ' ROWS FETCH NEXT 1000 ROWS ONLY', 1000).then(function (r) {
                out = out.concat(r);
                if (r.length < 1000 || out.length >= max) return out.slice(0, max);
                return page(off + 1000);
            });
        }
        return page(0);
    };
    FAS.write = function (sql) { return FAS.call('executewrite', { sql: sql }); };
    /** A SQL literal; `max` cuts to that many characters without ever cutting inside a surrogate pair. */
    FAS.lit = function (s, max) { if (s == null || s === '') return 'NULL'; s = String(s); if (max && s.length > max) { s = s.slice(0, max); if (/[\uD800-\uDBFF]$/.test(s)) s = s.slice(0, -1); } return "'" + s.replace(/'/g, "''") + "'"; };
    FAS.num = function (n) { if (n == null || n === '' || isNaN(+n)) return 'NULL'; return String(+n); };
    FAS.date = function (iso) { if (!iso) return 'NULL'; var s = String(iso).replace(' ', 'T').slice(0, 19); if (s.length === 10) s += 'T00:00:00'; if (s.length === 16) s += ':00'; return "TO_DATE('" + s + "', 'YYYY-MM-DD\"T\"HH24:MI:SS')"; };

    // ── CLOBs through the gateway ─────────────────────────────────
    // Oracle counts CHARACTERS (code points) where a JS string counts UTF-16 units, and the gateway fetches every text
    // column into a 4,000-BYTE buffer: a 3,900-character piece of code with box-drawing banners or accents came back
    // cut short (the end of every long piece was lost — syntax errors in the published app). So: every length that
    // reaches Oracle is a code-point count, no piece is ever cut inside a surrogate pair, a read piece is at most
    // CLOB_READ characters (≤ 3,600 bytes even when every character is escaped as \uXXXX), a written literal at most
    // CLOB_WRITE characters and CLOB_WRITE_BYTES bytes (Oracle's 4,000-byte literal limit, quotes doubled), and every
    // write and read is checked against LENGTH() — a CLOB that does not round-trip throws instead of running damaged.
    FAS.CLOB_READ = 600; FAS.CLOB_WRITE = 1000; FAS.CLOB_WRITE_BYTES = 3800; FAS.CLOB_COLS = 200;
    FAS.cpLen = function (s) { s = String(s == null ? '' : s); var pairs = s.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g); return s.length - (pairs ? pairs.length : 0); };
    FAS.utf8Len = function (s) { s = String(s == null ? '' : s); var n = 0; for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); if (c < 0x80) n += 1; else if (c < 0x800) n += 2; else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xFC00) === 0xDC00) { n += 4; i++; } else n += 3; } return n; };
    /** Cuts a string into pieces of at most `chars` code points and (when given) `bytes` UTF-8 bytes — a quote counts twice when `dq` (it will be doubled). */
    FAS.pieces = function (s, chars, bytes, dq) {
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
    FAS.clob = function (s) { if (s == null || s === '') return 'NULL'; return FAS.pieces(s, FAS.CLOB_WRITE, FAS.CLOB_WRITE_BYTES, true).map(function (p) { return "TO_CLOB('" + p.replace(/'/g, "''") + "')"; }).join(' || '); };
    /** Writes a long CLOB: empty it, append groups of literals (one statement each, about 16,000 characters), then check LENGTH() against the code points written. */
    FAS.writeClob = function (table, col, where, text) {
        text = text == null ? '' : String(text);
        var pieces = FAS.pieces(text, FAS.CLOB_WRITE, FAS.CLOB_WRITE_BYTES, true), groups = [];
        for (var i = 0; i < pieces.length; i += 16) groups.push(pieces.slice(i, i + 16));
        return FAS.write('UPDATE ' + table + ' SET ' + col + ' = EMPTY_CLOB() WHERE ' + where).then(function () {
            return groups.reduce(function (p, g) { return p.then(function () { return FAS.write('UPDATE ' + table + ' SET ' + col + ' = ' + col + ' || ' + g.map(function (x) { return "TO_CLOB('" + x.replace(/'/g, "''") + "')"; }).join(' || ') + ' WHERE ' + where); }); }, Promise.resolve());
        }).then(function () {
            return FAS.rows('SELECT NVL(LENGTH(' + col + '), 0) AS L FROM ' + table + ' WHERE ' + where, 2);
        }).then(function (r) {
            var want = FAS.cpLen(text), got = r.length ? +r[0].L || 0 : -1;
            if (got !== want) throw new Error('APEX kept ' + (got < 0 ? 'no row' : got.toLocaleString() + ' characters') + ' of the ' + want.toLocaleString() + ' written to ' + table + '.' + col + ' — the write is damaged, nothing was changed on the phones');
            return want;
        });
    };
    /** Reads a CLOB column of some rows → { key: text }: LENGTH() first, then pieces of CLOB_READ characters as columns of one query (CLOB_COLS per call), checked against LENGTH(). */
    FAS.readClob = function (table, col, keyCol, ids, piece) {
        piece = Math.min(piece || FAS.CLOB_READ, FAS.CLOB_READ); var out = {}, lens = {};
        if (!ids.length) return Promise.resolve(out);
        var where = ' WHERE ' + keyCol + ' IN (' + ids.map(function (i) { return FAS.lit(i); }).join(', ') + ')';
        return FAS.rows('SELECT ' + keyCol + ' AS K, NVL(LENGTH(' + col + '), 0) AS L FROM ' + table + where, 1000).then(function (r) {
            var max = 0; r.forEach(function (x) { out[x.K] = ''; lens[x.K] = +x.L || 0; max = Math.max(max, lens[x.K]); });
            var calls = []; for (var p = 1; p <= max; p += piece * FAS.CLOB_COLS) calls.push(p);
            return calls.reduce(function (pr, p0) {
                return pr.then(function () {
                    var cols = []; for (var k = 0; k < FAS.CLOB_COLS && p0 + k * piece <= max; k++) cols.push('TO_CHAR(SUBSTR(' + col + ', ' + (p0 + k * piece) + ', ' + piece + ')) AS P' + k);
                    return FAS.rows('SELECT ' + keyCol + ' AS K, ' + cols.join(', ') + ' FROM ' + table + where + ' AND LENGTH(' + col + ') >= ' + p0, 1000).then(function (rows) {
                        rows.forEach(function (x) { var s = ''; for (var k = 0; k < cols.length; k++) { var v = x['P' + k]; if (v == null) break; s += v; } out[x.K] = (out[x.K] || '') + s; });
                    });
                });
            }, Promise.resolve());
        }).then(function () {
            Object.keys(out).forEach(function (k) { var got = FAS.cpLen(out[k]); if (got !== lens[k]) throw new Error(table + '.' + col + ' of ' + k + ' came back damaged from APEX: ' + got.toLocaleString() + ' of ' + lens[k].toLocaleString() + ' characters'); });
            return out;
        });
    };
    /** First position (code points) where two texts differ, with a little context — for the publish check. */
    FAS.firstDiff = function (a, b) {
        a = Array.from(String(a || '')); b = Array.from(String(b || ''));
        var n = Math.min(a.length, b.length), i = 0; while (i < n && a[i] === b[i]) i++;
        if (i === n && a.length === b.length) return null;
        return { at: i, line: a.slice(0, i).join('').split('\n').length, expected: a.slice(i, i + 40).join(''), got: b.slice(i, i + 40).join(''), lenA: a.length, lenB: b.length };
    };
    /** ECDSA P-256 / SHA-256 check of `appId.version.codeSha.manifestSha` with a public key (SPKI base64) — the same check the phones run. */
    FAS.verifySig = function (spki, payload, sigB64) {
        function bytes(b64) { var bin = atob(String(b64 || '').replace(/-/g, '+').replace(/_/g, '/')), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
        return crypto.subtle.importKey('spki', bytes(spki), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
            .then(function (key) { return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, bytes(sigB64), new TextEncoder().encode(String(payload))); })
            .then(function (ok) { return !!ok; }, function () { return false; });
    };
    FAS.sha256 = function (text) {
        return crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text))).then(function (b) { var a = new Uint8Array(b), s = ''; for (var i = 0; i < a.length; i++) s += (a[i] < 16 ? '0' : '') + a[i].toString(16); return s; });
    };

    // ── tables (same DDL as apex_sql/97_field_apps.sql) ───────────
    FAS.DDL = {
        WMS_FIELD_APPS: "CREATE TABLE wms_field_apps (app_id VARCHAR2(60) PRIMARY KEY, name VARCHAR2(200), kind VARCHAR2(10) DEFAULT 'CODE', version NUMBER DEFAULT 1, status VARCHAR2(12) DEFAULT 'DRAFT', pod VARCHAR2(20), icon VARCHAR2(16), manifest_json CLOB, code CLOB, code_sha256 VARCHAR2(64), manifest_sha256 VARCHAR2(64), signature VARCHAR2(200), key_id VARCHAR2(16), code_bytes NUMBER, expires_at DATE, notes VARCHAR2(1000), created_by VARCHAR2(100), created_date DATE DEFAULT SYSDATE, changed_by VARCHAR2(100), changed_date DATE, published_by VARCHAR2(100), published_date DATE)",
        WMS_FIELD_APP_USERS: "CREATE TABLE wms_field_app_users (app_id VARCHAR2(60), username VARCHAR2(100), added_by VARCHAR2(100), added_date DATE DEFAULT SYSDATE, PRIMARY KEY (app_id, username))",
        WMS_FIELD_QUERIES: "CREATE TABLE wms_field_queries (app_id VARCHAR2(60), qname VARCHAR2(60), sql_text CLOB, max_rows NUMBER DEFAULT 5000, notes VARCHAR2(400), changed_by VARCHAR2(100), changed_date DATE, PRIMARY KEY (app_id, qname))",
        WMS_FIELD_DEVICES: "CREATE TABLE wms_field_devices (device_id VARCHAR2(80) PRIMARY KEY, label VARCHAR2(200), username VARCHAR2(100), platform VARCHAR2(40), app_version VARCHAR2(40), key_hash VARCHAR2(64), paired_at DATE, paired_by VARCHAR2(100), last_seen DATE, revoked VARCHAR2(1) DEFAULT 'N', revoked_by VARCHAR2(100), revoked_date DATE, revoke_reason VARCHAR2(400))",
        WMS_FIELD_PAIRINGS: "CREATE TABLE wms_field_pairings (code_hash VARCHAR2(64) PRIMARY KEY, username VARCHAR2(100), label VARCHAR2(200), created_by VARCHAR2(100), created_date DATE DEFAULT SYSDATE, expires_at DATE, used_at DATE, device_id VARCHAR2(80))",
        WMS_FIELD_SUBMISSIONS: "CREATE TABLE wms_field_submissions (sub_id VARCHAR2(80) PRIMARY KEY, app_id VARCHAR2(60), kind VARCHAR2(40), username VARCHAR2(100), device_id VARCHAR2(80), doc_ref VARCHAR2(120), amount NUMBER, status VARCHAR2(12) DEFAULT 'NEW', doc_json CLOB, error_text VARCHAR2(2000), created_date DATE DEFAULT SYSDATE, processed_date DATE)",
        WMS_FIELD_PHOTOS: "CREATE TABLE wms_field_photos (photo_id VARCHAR2(80) PRIMARY KEY, app_id VARCHAR2(60), sub_id VARCHAR2(80), username VARCHAR2(100), device_id VARCHAR2(80), taken_at DATE, lat NUMBER, lng NUMBER, trip_id VARCHAR2(40), bay VARCHAR2(60), ref1 VARCHAR2(120), ref2 VARCHAR2(120), note VARCHAR2(1000), mime VARCHAR2(60), bytes NUMBER, sha256 VARCHAR2(64), width NUMBER, height NUMBER, image BLOB, vision_op VARCHAR2(30), vision_json CLOB, vision_at DATE, vision_by VARCHAR2(100), vision_count NUMBER, expected_count NUMBER, created_date DATE DEFAULT SYSDATE)",
        WMS_FIELD_SETTINGS: "CREATE TABLE wms_field_settings (skey VARCHAR2(60) PRIMARY KEY, val_json CLOB, changed_by VARCHAR2(100), changed_date DATE)",
        WMS_POS_ITEMS: "CREATE TABLE wms_pos_items (pod VARCHAR2(20), item_code VARCHAR2(80), description VARCHAR2(400), uom VARCHAR2(20), barcode VARCHAR2(80), list_price NUMBER, currency VARCHAR2(10), tax_code VARCHAR2(40), cons NUMBER, cons_item VARCHAR2(80), crt_item VARCHAR2(80), crt_price NUMBER, crt_min_qty NUMBER, crt_default_qty NUMBER, category VARCHAR2(120), sub_category VARCHAR2(120), brand VARCHAR2(120), supplier VARCHAR2(200), profit_center VARCHAR2(120), group_code VARCHAR2(120), item_type VARCHAR2(60), image_url VARCHAR2(600), active VARCHAR2(1) DEFAULT 'Y', changed_date DATE DEFAULT SYSDATE, PRIMARY KEY (pod, item_code))",
        WMS_POS_CUSTOMERS: "CREATE TABLE wms_pos_customers (pod VARCHAR2(20), customer_number VARCHAR2(80), customer_name VARCHAR2(300), category VARCHAR2(120), customer_class VARCHAR2(120), credit_limit NUMBER, vat VARCHAR2(60), brn VARCHAR2(60), phone VARCHAR2(60), address VARCHAR2(600), price_list VARCHAR2(120), active VARCHAR2(1) DEFAULT 'Y', changed_date DATE DEFAULT SYSDATE, PRIMARY KEY (pod, customer_number))",
        WMS_POS_SHIFTS: "CREATE TABLE wms_pos_shifts (shift_id VARCHAR2(80) PRIMARY KEY, pod VARCHAR2(20), device_id VARCHAR2(80), username VARCHAR2(100), opened_at DATE, float_amt NUMBER, closed_at DATE, counted NUMBER, expected NUMBER, variance NUMBER, sales_n NUMBER, net NUMBER, status VARCHAR2(12), doc_json CLOB, created_date DATE DEFAULT SYSDATE)",
        WMS_POS_SALES: "CREATE TABLE wms_pos_sales (sale_id VARCHAR2(80) PRIMARY KEY, sale_number VARCHAR2(60), kind VARCHAR2(10), status VARCHAR2(12), pod VARCHAR2(20), shift_id VARCHAR2(80), device_id VARCHAR2(80), username VARCHAR2(100), customer_number VARCHAR2(80), customer_name VARCHAR2(300), opened_at DATE, done_at DATE, gross NUMBER, disc NUMBER, tax NUMBER, cons NUMBER, crates NUMBER, net NUMBER, rounded NUMBER, paid NUMBER, change_amt NUMBER, lines_n NUMBER, units NUMBER, return_of VARCHAR2(80), mra_status VARCHAR2(20), mra_irn VARCHAR2(120), fusion_order VARCHAR2(60), lat NUMBER, lng NUMBER, note VARCHAR2(1000), doc_json CLOB, created_date DATE DEFAULT SYSDATE)",
        WMS_POS_SALE_LINES: "CREATE TABLE wms_pos_sale_lines (sale_id VARCHAR2(80), line_no NUMBER, line_id VARCHAR2(80), item_code VARCHAR2(80), description VARCHAR2(400), uom VARCHAR2(20), barcode VARCHAR2(80), qty NUMBER, list_price NUMBER, sell_price NUMBER, disc_pct NUMBER, disc_cust NUMBER, disc_mkt NUMBER, disc_add NUMBER, tax_code VARCHAR2(40), tax_pct NUMBER, gross NUMBER, tax NUMBER, cons NUMBER, crates NUMBER, crate_qty NUMBER, net NUMBER, line_type VARCHAR2(10), return_of_line VARCHAR2(80), note VARCHAR2(400), PRIMARY KEY (sale_id, line_no))",
        WMS_POS_PAYMENTS: "CREATE TABLE wms_pos_payments (sale_id VARCHAR2(80), seq NUMBER, tender VARCHAR2(20), amount NUMBER, pay_ref VARCHAR2(120), paid_at DATE, PRIMARY KEY (sale_id, seq))"
    };
    var ready = null;
    FAS.ensure = function () {
        if (ready) return ready;
        var names = Object.keys(FAS.DDL);
        ready = FAS.rows("SELECT table_name AS T FROM user_tables WHERE table_name IN (" + names.map(function (n) { return "'" + n + "'"; }).join(', ') + ")", 100).then(function (r) {
            var have = r.map(function (x) { return x.T; });
            return names.filter(function (t) { return have.indexOf(t) < 0; }).reduce(function (p, t) { return p.then(function () { return FAS.write(FAS.DDL[t]).catch(function (e) { if (!/ORA-00955/.test(String(e))) throw e; }); }); }, Promise.resolve());
        }).then(function () {
            return FAS.write("MERGE INTO wms_field_settings t USING (SELECT 'signing_keys' AS skey FROM dual) s ON (t.skey = s.skey) WHEN NOT MATCHED THEN INSERT (skey, val_json, changed_by, changed_date) VALUES ('signing_keys', '[]', " + FAS.lit(FAS.user()) + ", SYSDATE)").catch(function () { });
        }).catch(function (e) { ready = null; throw e; });
        return ready;
    };
    FAS.tableStatus = function () {
        var names = Object.keys(FAS.DDL);
        return FAS.rows("SELECT table_name AS T FROM user_tables WHERE table_name IN (" + names.map(function (n) { return "'" + n + "'"; }).join(', ') + ")", 100).then(function (r) { var have = r.map(function (x) { return x.T; }); return names.map(function (n) { return { table: n, exists: have.indexOf(n) >= 0 }; }); });
    };
    /** Are the phone handlers of script 97 installed? field/ping with a dummy key answers 401 JSON when they are. */
    FAS.ping = function () {
        return FAS.get(FAS.WM + '/field/ping?k=probe-not-a-key', 30000).then(function (r) {
            var installed = r.status === 401 && r.json && r.json.ok === false;
            return { installed: installed, status: r.status, text: String(r.text || '').slice(0, 200) };
        }).catch(function (e) { return { installed: false, status: 0, text: e.message }; });
    };

    // ── settings & signing keys ───────────────────────────────────
    FAS.settings = {
        get: function (key) { return FAS.readClob('wms_field_settings', 'val_json', 'skey', [key]).then(function (m) { var s = m[key]; if (!s) return null; try { return JSON.parse(s); } catch (e) { return null; } }); },
        set: function (key, val) {
            return FAS.write("MERGE INTO wms_field_settings t USING (SELECT " + FAS.lit(key) + " AS skey FROM dual) s ON (t.skey = s.skey) WHEN MATCHED THEN UPDATE SET changed_by = " + FAS.lit(FAS.user()) + ", changed_date = SYSDATE WHEN NOT MATCHED THEN INSERT (skey, val_json, changed_by, changed_date) VALUES (" + FAS.lit(key) + ", EMPTY_CLOB(), " + FAS.lit(FAS.user()) + ", SYSDATE)")
                .then(function () { return FAS.writeClob('wms_field_settings', 'val_json', 'skey = ' + FAS.lit(key), JSON.stringify(val)); });
        }
    };
    FAS.keys = {
        list: function () { return FAS.settings.get('signing_keys').then(function (k) { return Array.isArray(k) ? k : []; }); },
        ensure: function (k) {
            return FAS.keys.list().then(function (list) {
                if (list.some(function (x) { return x.keyId === k.keyId; })) return list;
                list.push({ keyId: k.keyId, spki: k.spki, by: FAS.user(), at: new Date().toISOString().slice(0, 19), pc: k.pc || '' });
                return FAS.settings.set('signing_keys', list).then(function () { return list; });
            });
        },
        remove: function (keyId) { return FAS.keys.list().then(function (list) { return FAS.settings.set('signing_keys', list.filter(function (x) { return x.keyId !== keyId; })); }); }
    };

    // ── apps ──────────────────────────────────────────────────────
    var APP_COLS = "a.app_id AS APP_ID, a.name AS NAME, a.kind AS KIND, a.version AS VERSION, a.status AS STATUS, a.pod AS POD, a.icon AS ICON, a.code_sha256 AS CODE_SHA256, a.manifest_sha256 AS MANIFEST_SHA256, a.signature AS SIGNATURE, a.key_id AS KEY_ID, a.code_bytes AS CODE_BYTES, TO_CHAR(a.expires_at, 'YYYY-MM-DD\"T\"HH24:MI') AS EXPIRES_AT, a.notes AS NOTES, a.created_by AS CREATED_BY, TO_CHAR(a.created_date, 'YYYY-MM-DD\"T\"HH24:MI') AS CREATED, a.changed_by AS CHANGED_BY, TO_CHAR(a.changed_date, 'YYYY-MM-DD\"T\"HH24:MI') AS CHANGED, a.published_by AS PUBLISHED_BY, TO_CHAR(a.published_date, 'YYYY-MM-DD\"T\"HH24:MI') AS PUBLISHED, (SELECT COUNT(*) FROM wms_field_app_users u WHERE u.app_id = a.app_id) AS USERS_N, (SELECT LISTAGG(u.username, ', ') WITHIN GROUP (ORDER BY u.username) FROM wms_field_app_users u WHERE u.app_id = a.app_id) AS USERS";
    FAS.apps = {
        list: function () { return FAS.rows('SELECT ' + APP_COLS + ' FROM wms_field_apps a ORDER BY a.name', 500); },
        get: function (id) {
            return FAS.rows('SELECT ' + APP_COLS + ' FROM wms_field_apps a WHERE a.app_id = ' + FAS.lit(id), 1).then(function (r) {
                if (!r.length) return null;
                var app = r[0];
                return Promise.all([FAS.readClob('wms_field_apps', 'manifest_json', 'app_id', [id]), FAS.readClob('wms_field_apps', 'code', 'app_id', [id]), FAS.apps.queries(id)]).then(function (x) {
                    app.MANIFEST = x[0][id] || ''; app.CODE = x[1][id] || ''; app.QUERIES = x[2];
                    try { app.manifest = JSON.parse(app.MANIFEST || '{}'); } catch (e) { app.manifest = {}; }
                    return app;
                });
            });
        },
        /** What the phones will get: reads the row back and re-checks it like the shell does → {ok, why, len, codeSha, manSha, signed, keyKnown, diff?}. `expectCode` = the code just written (names the first difference). */
        check: function (id, expectCode, expectManifest) {
            return FAS.apps.get(id).then(function (a) {
                if (!a) return { ok: false, why: 'App ' + id + ' is not in APEX' };
                var r = { ok: true, why: '', len: FAS.cpLen(a.CODE), bytes: FAS.utf8Len(a.CODE), status: a.STATUS, version: a.VERSION, keyId: a.KEY_ID };
                if (expectCode != null && a.CODE !== expectCode) { r.ok = false; r.diff = FAS.firstDiff(expectCode, a.CODE); r.why = 'the code in APEX is not the code written (differs at character ' + (r.diff ? r.diff.at.toLocaleString() + ', line ' + r.diff.line : '?') + ')'; return r; }
                if (expectManifest != null && a.MANIFEST !== expectManifest) { r.ok = false; r.diff = FAS.firstDiff(expectManifest, a.MANIFEST); r.why = 'the manifest in APEX is not the manifest written'; return r; }
                return Promise.all([FAS.sha256(a.CODE), FAS.sha256(a.MANIFEST), FAS.keys.list()]).then(function (x) {
                    r.codeSha = x[0]; r.manSha = x[1];
                    if (a.CODE_SHA256 && a.CODE_SHA256.toLowerCase() !== x[0]) { r.ok = false; r.why = 'the code in APEX is not the code that was signed (SHA-256 ' + x[0].slice(0, 12) + '… instead of ' + a.CODE_SHA256.slice(0, 12) + '…)'; return r; }
                    if (a.MANIFEST_SHA256 && a.MANIFEST_SHA256.toLowerCase() !== x[1]) { r.ok = false; r.why = 'the manifest in APEX is not the manifest that was signed'; return r; }
                    if (!a.SIGNATURE || !a.KEY_ID) { r.signed = false; r.why = a.STATUS === 'PUBLISHED' ? 'published but not signed' : 'a draft, not signed'; return r; }
                    var key = (x[2] || []).filter(function (k) { return k && k.keyId === a.KEY_ID && k.spki; })[0];
                    r.keyKnown = !!key;
                    if (!key) { r.ok = false; r.why = 'signed with key ' + a.KEY_ID + ', which is not in the published keys — the phones will refuse it'; return r; }
                    return FAS.verifySig(key.spki, id + '.' + a.VERSION + '.' + x[0] + '.' + x[1], a.SIGNATURE).then(function (ok) { r.signed = ok; if (!ok) { r.ok = false; r.why = 'the signature does not match'; } return r; });
                });
            });
        },
        /** a = {appId, name, kind, version, status, pod, icon, manifest (string), code (string), codeSha256, manifestSha256, signature, keyId, expiresAt, notes, publish} */
        save: function (a) {
            var me = FAS.lit(FAS.user());
            var set = 'name = ' + FAS.lit(a.name, 200) + ', kind = ' + FAS.lit(a.kind || 'CODE') + ', version = ' + FAS.num(a.version != null ? a.version : 1) + ', status = ' + FAS.lit(a.status || 'DRAFT') + ', pod = ' + FAS.lit(a.pod, 20) + ', icon = ' + FAS.lit(a.icon, 16) +
                ', code_sha256 = ' + FAS.lit(a.codeSha256) + ', manifest_sha256 = ' + FAS.lit(a.manifestSha256) + ', signature = ' + FAS.lit(a.signature) + ', key_id = ' + FAS.lit(a.keyId) + ', code_bytes = ' + FAS.num(a.code ? FAS.utf8Len(a.code) : 0) +
                ', expires_at = ' + FAS.date(a.expiresAt) + ', notes = ' + FAS.lit(a.notes, 1000) + ', changed_by = ' + me + ', changed_date = SYSDATE' + (a.publish ? ', published_by = ' + me + ', published_date = SYSDATE' : '');
            return FAS.write('MERGE INTO wms_field_apps t USING (SELECT ' + FAS.lit(a.appId) + ' AS app_id FROM dual) s ON (t.app_id = s.app_id) WHEN MATCHED THEN UPDATE SET ' + set +
                ' WHEN NOT MATCHED THEN INSERT (app_id, name, kind, version, status, pod, icon, manifest_json, code, code_sha256, manifest_sha256, signature, key_id, code_bytes, expires_at, notes, created_by, created_date, changed_by, changed_date, published_by, published_date) VALUES (' +
                FAS.lit(a.appId) + ', ' + FAS.lit(a.name, 200) + ', ' + FAS.lit(a.kind || 'CODE') + ', ' + FAS.num(a.version != null ? a.version : 1) + ', ' + FAS.lit(a.status || 'DRAFT') + ', ' + FAS.lit(a.pod, 20) + ', ' + FAS.lit(a.icon, 16) + ', EMPTY_CLOB(), EMPTY_CLOB(), ' + FAS.lit(a.codeSha256) + ', ' + FAS.lit(a.manifestSha256) + ', ' + FAS.lit(a.signature) + ', ' + FAS.lit(a.keyId) + ', ' + FAS.num(a.code ? FAS.utf8Len(a.code) : 0) + ', ' + FAS.date(a.expiresAt) + ', ' + FAS.lit(a.notes, 1000) + ', ' + me + ', SYSDATE, ' + me + ', SYSDATE, ' + (a.publish ? me + ', SYSDATE' : 'NULL, NULL') + ')')
                .then(function () { return a.manifest == null ? null : FAS.writeClob('wms_field_apps', 'manifest_json', 'app_id = ' + FAS.lit(a.appId), a.manifest); })
                .then(function () { return a.code == null ? null : FAS.writeClob('wms_field_apps', 'code', 'app_id = ' + FAS.lit(a.appId), a.code); });
        },
        setStatus: function (id, status) { return FAS.write('UPDATE wms_field_apps SET status = ' + FAS.lit(status) + ', changed_by = ' + FAS.lit(FAS.user()) + ', changed_date = SYSDATE WHERE app_id = ' + FAS.lit(id)); },
        del: function (id) {
            return FAS.write('DELETE FROM wms_field_app_users WHERE app_id = ' + FAS.lit(id)).then(function () { return FAS.write('DELETE FROM wms_field_queries WHERE app_id = ' + FAS.lit(id)); }).then(function () { return FAS.write('DELETE FROM wms_field_apps WHERE app_id = ' + FAS.lit(id)); });
        },
        users: function (id) { return FAS.rows('SELECT username AS U FROM wms_field_app_users WHERE app_id = ' + FAS.lit(id) + ' ORDER BY username', 1000).then(function (r) { return r.map(function (x) { return x.U; }); }); },
        setUsers: function (id, list) {
            list = (list || []).map(function (u) { return String(u).trim(); }).filter(Boolean).filter(function (u, i, a) { return a.indexOf(u) === i; });
            return FAS.write('DELETE FROM wms_field_app_users WHERE app_id = ' + FAS.lit(id)).then(function () {
                if (!list.length) return null;
                var chunks = []; for (var i = 0; i < list.length; i += 50) chunks.push(list.slice(i, i + 50));
                return chunks.reduce(function (p, c) { return p.then(function () { return FAS.write('INSERT INTO wms_field_app_users (app_id, username, added_by) ' + c.map(function (u) { return 'SELECT ' + FAS.lit(id) + ', ' + FAS.lit(u, 100) + ', ' + FAS.lit(FAS.user()) + ' FROM dual'; }).join(' UNION ALL ')); }); }, Promise.resolve());
            });
        },
        queries: function (id) {
            return FAS.rows('SELECT qname AS Q, max_rows AS M, notes AS N FROM wms_field_queries WHERE app_id = ' + FAS.lit(id) + ' ORDER BY qname', 200).then(function (r) {
                if (!r.length) return {};
                return FAS.rows("SELECT qname AS Q, TO_CHAR(SUBSTR(sql_text, 1, 3900)) AS S FROM wms_field_queries WHERE app_id = " + FAS.lit(id), 200).then(function (sq) {
                    var out = {}; r.forEach(function (x) { out[x.Q] = { maxRows: +x.M || 5000, notes: x.N || '', sql: '' }; });
                    sq.forEach(function (x) { if (out[x.Q]) out[x.Q].sql = x.S || ''; });
                    return out;
                });
            });
        },
        setQueries: function (id, qs) {
            qs = qs || {};
            return FAS.write('DELETE FROM wms_field_queries WHERE app_id = ' + FAS.lit(id)).then(function () {
                return Object.keys(qs).reduce(function (p, name) {
                    var q = qs[name] || {};
                    return p.then(function () { return FAS.write('INSERT INTO wms_field_queries (app_id, qname, sql_text, max_rows, notes, changed_by, changed_date) VALUES (' + FAS.lit(id) + ', ' + FAS.lit(name, 60) + ', ' + FAS.clob(q.sql || '') + ', ' + FAS.num(q.maxRows || 5000) + ', ' + FAS.lit(q.notes, 400) + ', ' + FAS.lit(FAS.user()) + ', SYSDATE)'); });
                }, Promise.resolve());
            });
        }
    };

    // ── devices & pairing ─────────────────────────────────────────
    FAS.devices = {
        list: function () { return FAS.rows("SELECT device_id AS DEVICE_ID, label AS LABEL, username AS USERNAME, platform AS PLATFORM, app_version AS APP_VERSION, TO_CHAR(paired_at, 'YYYY-MM-DD\"T\"HH24:MI') AS PAIRED, paired_by AS PAIRED_BY, TO_CHAR(last_seen, 'YYYY-MM-DD\"T\"HH24:MI') AS LAST_SEEN, revoked AS REVOKED, revoke_reason AS REVOKE_REASON FROM wms_field_devices ORDER BY last_seen DESC NULLS LAST", 500); },
        revoke: function (id, reason) { return FAS.write("UPDATE wms_field_devices SET revoked = 'Y', revoked_by = " + FAS.lit(FAS.user()) + ', revoked_date = SYSDATE, revoke_reason = ' + FAS.lit(reason, 400) + ' WHERE device_id = ' + FAS.lit(id)); },
        unrevoke: function (id) { return FAS.write("UPDATE wms_field_devices SET revoked = 'N', revoked_by = NULL, revoked_date = NULL, revoke_reason = NULL WHERE device_id = " + FAS.lit(id)); }
    };
    FAS.pair = {
        code: function () { var A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = '', a = new Uint8Array(8); crypto.getRandomValues(a); for (var i = 0; i < 8; i++) s += A[a[i] % A.length]; return s; },
        /** A one-time code for one person's phone, valid 15 minutes → { code, username, expires }. */
        create: function (username, label) {
            var code = FAS.pair.code();
            return FAS.sha256(code).then(function (h) {
                return FAS.write('INSERT INTO wms_field_pairings (code_hash, username, label, created_by, created_date, expires_at) VALUES (' + FAS.lit(h.toUpperCase()) + ', ' + FAS.lit(username, 100) + ', ' + FAS.lit(label, 200) + ', ' + FAS.lit(FAS.user()) + ', SYSDATE, SYSDATE + 15/1440)');
            }).then(function () { return { code: code, username: username, label: label, expires: new Date(Date.now() + 15 * 60000).toISOString() }; });
        },
        /** Redeems a code like a phone would (the desktop itself becomes a device for photo uploads). */
        redeem: function (code, label, deviceId) {
            return FAS.post(FAS.WM + '/field/pair', { code: code, label: label, platform: 'desktop', appVersion: 'wms', deviceId: deviceId || null }).then(function (r) {
                if (!r.json || r.json.ok === false) throw new Error((r.json && r.json.error) || ('Pairing failed (HTTP ' + r.status + ') — run apex_sql/97_field_apps.sql'));
                return r.json;
            });
        },
        pending: function () { return FAS.rows("SELECT username AS USERNAME, label AS LABEL, created_by AS CREATED_BY, TO_CHAR(created_date, 'HH24:MI') AS AT, TO_CHAR(expires_at, 'HH24:MI') AS EXPIRES, device_id AS DEVICE_ID, TO_CHAR(used_at, 'HH24:MI') AS USED FROM wms_field_pairings WHERE created_date > SYSDATE - 1 ORDER BY created_date DESC", 100); }
    };
    /** The desktop's own device key (kept on this PC), used for photo uploads and reads through the handlers. */
    FAS.device = {
        get: function () { try { return JSON.parse(localStorage.getItem('fieldapps.device') || 'null'); } catch (e) { return null; } },
        set: function (d) { try { localStorage.setItem('fieldapps.device', JSON.stringify(d)); } catch (e) { } },
        id: function () { var d = FAS.device.get(); if (d && d.deviceId) return d.deviceId; var id = 'desk_' + Math.random().toString(36).slice(2, 10); return id; },
        /** Pairs this desktop automatically (needs the handlers): a code for the WMS login, redeemed at once. */
        ensure: function () {
            var d = FAS.device.get();
            if (d && d.key) return Promise.resolve(d);
            var label = 'Desktop · ' + FAS.user();
            return FAS.pair.create(FAS.user(), label).then(function (p) { return FAS.pair.redeem(p.code, label, d && d.deviceId); }).then(function (r) {
                var nd = { deviceId: r.deviceId, key: r.key, username: r.username, at: new Date().toISOString() };
                FAS.device.set(nd); return nd;
            });
        }
    };

    // ── submissions ───────────────────────────────────────────────
    FAS.subs = {
        list: function (f) {
            f = f || {};
            var w = [];
            if (f.app) w.push('app_id = ' + FAS.lit(f.app));
            if (f.kind) w.push('kind = ' + FAS.lit(f.kind));
            if (f.status) w.push('status = ' + FAS.lit(f.status));
            if (f.user) w.push('UPPER(username) = ' + FAS.lit(String(f.user).toUpperCase()));
            if (f.from) w.push('created_date >= ' + FAS.date(f.from));
            if (f.to) w.push('created_date < ' + FAS.date(f.to) + ' + 1');
            return FAS.rows("SELECT sub_id AS SUB_ID, app_id AS APP_ID, kind AS KIND, username AS USERNAME, device_id AS DEVICE_ID, doc_ref AS DOC_REF, amount AS AMOUNT, status AS STATUS, error_text AS ERROR_TEXT, TO_CHAR(created_date, 'YYYY-MM-DD\"T\"HH24:MI:SS') AS CREATED, TO_CHAR(processed_date, 'YYYY-MM-DD\"T\"HH24:MI:SS') AS PROCESSED FROM wms_field_submissions" + (w.length ? ' WHERE ' + w.join(' AND ') : '') + ' ORDER BY created_date DESC FETCH FIRST ' + (f.max || 300) + ' ROWS ONLY', 1000);
        },
        doc: function (id) { return FAS.readClob('wms_field_submissions', 'doc_json', 'sub_id', [id]).then(function (m) { try { return JSON.parse(m[id] || 'null'); } catch (e) { return null; } }); },
        /** Insert (or replace) one submission with its document; then unpack the POS kinds like the handler does. */
        put: function (s) {
            var id = s.subId;
            return FAS.rows('SELECT COUNT(*) AS N FROM wms_field_submissions WHERE sub_id = ' + FAS.lit(id), 1).then(function (r) {
                var exists = r.length && +r[0].N > 0;
                var sql = exists
                    ? 'UPDATE wms_field_submissions SET doc_ref = ' + FAS.lit(s.ref, 120) + ', amount = ' + FAS.num(s.amount) + ", status = 'NEW', error_text = NULL WHERE sub_id = " + FAS.lit(id)
                    : 'INSERT INTO wms_field_submissions (sub_id, app_id, kind, username, device_id, doc_ref, amount, status, doc_json) VALUES (' + FAS.lit(id, 80) + ', ' + FAS.lit(s.app, 60) + ', ' + FAS.lit(s.kind, 40) + ', ' + FAS.lit(s.user, 100) + ', ' + FAS.lit(s.device, 80) + ', ' + FAS.lit(s.ref, 120) + ', ' + FAS.num(s.amount) + ", 'NEW', EMPTY_CLOB())";
                return FAS.write(sql);
            }).then(function () { return FAS.writeClob('wms_field_submissions', 'doc_json', 'sub_id = ' + FAS.lit(id), JSON.stringify(s.doc)); })
                .then(function () { return FAS.subs.process(id, s.kind, s.doc, s.user, s.device); });
        },
        /** Unpacks one submission into the POS tables (same result as wms_field_submit's unpack). */
        process: function (id, kind, doc, user, device) {
            var p = Promise.resolve('NEW');
            if (kind === 'pos_sale') p = FAS.pos.unpackSale(doc, user, device).then(function () { return 'DONE'; });
            else if (kind === 'pos_shift') p = FAS.pos.unpackShift(doc, user, device).then(function () { return 'DONE'; });
            return p.then(function (st) { return FAS.write('UPDATE wms_field_submissions SET status = ' + FAS.lit(st) + ', error_text = NULL, processed_date = ' + (st === 'NEW' ? 'NULL' : 'SYSDATE') + ' WHERE sub_id = ' + FAS.lit(id)).then(function () { return { ok: true, subId: id, status: st }; }); },
                function (e) { return FAS.write("UPDATE wms_field_submissions SET status = 'ERROR', error_text = " + FAS.lit(e.message, 2000) + ' WHERE sub_id = ' + FAS.lit(id)).then(function () { return { ok: true, subId: id, status: 'ERROR', error: e.message }; }); });
        },
        /** Every NEW or ERROR pos_* submission → unpacked again (the desktop as the processor). */
        processNew: function () {
            return FAS.subs.list({ max: 200 }).then(function (rows) {
                var todo = rows.filter(function (r) { return (r.STATUS === 'NEW' || r.STATUS === 'ERROR') && /^pos_/.test(r.KIND || ''); });
                return todo.reduce(function (p, r) { return p.then(function (n) { return FAS.subs.doc(r.SUB_ID).then(function (doc) { if (!doc) return n; return FAS.subs.process(r.SUB_ID, r.KIND, doc, r.USERNAME, r.DEVICE_ID).then(function () { return n + 1; }); }); }); }, Promise.resolve(0));
            });
        }
    };

    // ── POS tables ────────────────────────────────────────────────
    function unionInsert(table, cols, rows, each) {
        var chunks = []; for (var i = 0; i < rows.length; i += 40) chunks.push(rows.slice(i, i + 40));
        return chunks.reduce(function (p, c) { return p.then(function () { return FAS.write('INSERT INTO ' + table + ' (' + cols + ') ' + c.map(function (r, i) { return 'SELECT ' + each(r, i) + ' FROM dual'; }).join(' UNION ALL ')); }); }, Promise.resolve());
    }
    FAS.pos = {
        unpackSale: function (d, user, device) {
            var id = d.saleId; if (!id) return Promise.reject(new Error('saleId missing'));
            var t = d.totals || {}, c = d.customer || {}, g = d.gps || {};
            var set = 'sale_number = ' + FAS.lit(d.number, 60) + ', kind = ' + FAS.lit(d.kind, 10) + ', status = ' + FAS.lit(d.status, 12) + ', pod = ' + FAS.lit(d.pod, 20) + ', shift_id = ' + FAS.lit(d.shiftId, 80) + ', device_id = ' + FAS.lit(d.device || device, 80) + ', username = ' + FAS.lit(d.user || user, 100) +
                ', customer_number = ' + FAS.lit(c.number, 80) + ', customer_name = ' + FAS.lit(c.name, 300) + ', opened_at = ' + FAS.date(d.openedAt) + ', done_at = ' + FAS.date(d.doneAt) + ', gross = ' + FAS.num(t.gross) + ', disc = ' + FAS.num(t.disc) + ', tax = ' + FAS.num(t.tax) + ', cons = ' + FAS.num(t.cons) + ', crates = ' + FAS.num(t.crates) + ', net = ' + FAS.num(t.net) + ', rounded = ' + FAS.num(t.rounded) + ', paid = ' + FAS.num(t.paid) + ', change_amt = ' + FAS.num(t.change) +
                ', lines_n = ' + FAS.num(t.items) + ', units = ' + FAS.num(t.units) + ', return_of = ' + FAS.lit(d.returnOf && d.returnOf.saleId, 80) + ', mra_status = ' + FAS.lit(d.mra && d.mra.status, 20) + ', lat = ' + FAS.num(g.lat) + ', lng = ' + FAS.num(g.lng) + ', note = ' + FAS.lit(d.note, 1000);
            return FAS.write('DELETE FROM wms_pos_sale_lines WHERE sale_id = ' + FAS.lit(id)).then(function () { return FAS.write('DELETE FROM wms_pos_payments WHERE sale_id = ' + FAS.lit(id)); })
                .then(function () { return FAS.write('MERGE INTO wms_pos_sales t USING (SELECT ' + FAS.lit(id) + ' AS sale_id FROM dual) s ON (t.sale_id = s.sale_id) WHEN MATCHED THEN UPDATE SET ' + set + ' WHEN NOT MATCHED THEN INSERT (sale_id, doc_json) VALUES (' + FAS.lit(id) + ', EMPTY_CLOB())'); })
                .then(function () { return FAS.write('UPDATE wms_pos_sales SET ' + set + ' WHERE sale_id = ' + FAS.lit(id)); })
                .then(function () { return FAS.writeClob('wms_pos_sales', 'doc_json', 'sale_id = ' + FAS.lit(id), JSON.stringify(d)); })
                .then(function () {
                    return unionInsert('wms_pos_sale_lines', 'sale_id, line_no, line_id, item_code, description, uom, barcode, qty, list_price, sell_price, disc_pct, disc_cust, disc_mkt, disc_add, tax_code, tax_pct, gross, tax, cons, crates, crate_qty, net, line_type, return_of_line, note', d.lines || [], function (l, i) {
                        var k = l.calc || {};
                        return [FAS.lit(id), i + 1, FAS.lit(l.id, 80), FAS.lit(l.item, 80), FAS.lit(l.desc, 400), FAS.lit(l.uom, 20), FAS.lit(l.barcode, 80), FAS.num(k.qty != null ? k.qty : l.qty), FAS.num(l.price), FAS.num(k.sell), FAS.num(k.pct), FAS.num(l.discCust), FAS.num(l.discMkt), FAS.num(l.discAdd), FAS.lit(l.tax, 40), FAS.num(k.taxPct), FAS.num(k.gross), FAS.num(k.tax), FAS.num(k.consTotal), FAS.num(k.crtTotal), FAS.num(k.crtQty), FAS.num(k.net), FAS.lit(l.type, 10), FAS.lit(l.returnOf && l.returnOf.lineId, 80), FAS.lit(l.note, 400)].join(', ');
                    });
                })
                .then(function () { return unionInsert('wms_pos_payments', 'sale_id, seq, tender, amount, pay_ref, paid_at', d.payments || [], function (p, i) { return [FAS.lit(id), i + 1, FAS.lit(p.tender, 20), FAS.num(p.amount), FAS.lit(p.ref, 120), FAS.date(p.at)].join(', '); }); });
        },
        unpackShift: function (d, user, device) {
            var id = d.shiftId; if (!id) return Promise.reject(new Error('shiftId missing'));
            var z = (d.summary && d.summary.sum) || {};
            var set = 'pod = ' + FAS.lit(d.pod, 20) + ', device_id = ' + FAS.lit(d.device || device, 80) + ', username = ' + FAS.lit(d.user || user, 100) + ', opened_at = ' + FAS.date(d.openedAt) + ', float_amt = ' + FAS.num(d.floatAmt) + ', closed_at = ' + FAS.date(d.closedAt) + ', counted = ' + FAS.num(d.counted) + ', expected = ' + FAS.num(d.expected) + ', variance = ' + FAS.num(d.variance) + ', sales_n = ' + FAS.num(z.sales) + ', net = ' + FAS.num(z.net) + ', status = ' + FAS.lit(d.status, 12);
            return FAS.write('MERGE INTO wms_pos_shifts t USING (SELECT ' + FAS.lit(id) + ' AS shift_id FROM dual) s ON (t.shift_id = s.shift_id) WHEN MATCHED THEN UPDATE SET ' + set + ' WHEN NOT MATCHED THEN INSERT (shift_id, doc_json) VALUES (' + FAS.lit(id) + ', EMPTY_CLOB())')
                .then(function () { return FAS.write('UPDATE wms_pos_shifts SET ' + set + ' WHERE shift_id = ' + FAS.lit(id)); })
                .then(function () { return FAS.writeClob('wms_pos_shifts', 'doc_json', 'shift_id = ' + FAS.lit(id), JSON.stringify(d)); });
        },
        sales: function (f) {
            f = f || {}; var w = [];
            if (f.pod) w.push('pod = ' + FAS.lit(f.pod));
            if (f.from) w.push('done_at >= ' + FAS.date(f.from));
            if (f.to) w.push('done_at < ' + FAS.date(f.to) + ' + 1');
            if (f.device) w.push('device_id = ' + FAS.lit(f.device));
            return FAS.rows("SELECT sale_id AS SALE_ID, sale_number AS SALE_NUMBER, kind AS KIND, status AS STATUS, pod AS POD, shift_id AS SHIFT_ID, device_id AS DEVICE_ID, username AS USERNAME, customer_number AS CUSTOMER_NUMBER, customer_name AS CUSTOMER_NAME, TO_CHAR(done_at, 'YYYY-MM-DD\"T\"HH24:MI') AS DONE_AT, gross AS GROSS, disc AS DISC, tax AS TAX, cons AS CONS, crates AS CRATES, net AS NET, rounded AS ROUNDED, paid AS PAID, change_amt AS CHANGE_AMT, lines_n AS LINES_N, units AS UNITS, return_of AS RETURN_OF, mra_status AS MRA_STATUS FROM wms_pos_sales" + (w.length ? ' WHERE ' + w.join(' AND ') : '') + ' ORDER BY done_at DESC FETCH FIRST ' + (f.max || 500) + ' ROWS ONLY', 1000);
        },
        saleLines: function (id) { return FAS.rows('SELECT line_no AS LINE_NO, item_code AS ITEM_CODE, description AS DESCRIPTION, qty AS QTY, list_price AS LIST_PRICE, sell_price AS SELL_PRICE, disc_pct AS DISC_PCT, tax_pct AS TAX_PCT, gross AS GROSS, tax AS TAX, cons AS CONS, crates AS CRATES, net AS NET, line_type AS LINE_TYPE, note AS NOTE FROM wms_pos_sale_lines WHERE sale_id = ' + FAS.lit(id) + ' ORDER BY line_no', 500); },
        payments: function (id) { return FAS.rows("SELECT seq AS SEQ, tender AS TENDER, amount AS AMOUNT, pay_ref AS PAY_REF, TO_CHAR(paid_at, 'HH24:MI') AS AT FROM wms_pos_payments WHERE sale_id = " + FAS.lit(id) + ' ORDER BY seq', 100); },
        tenders: function (f) {
            f = f || {}; var w = ['s.sale_id = p.sale_id', "p.pay_ref <> 'change' OR p.pay_ref IS NULL"];
            if (f.pod) w.push('s.pod = ' + FAS.lit(f.pod)); if (f.from) w.push('s.done_at >= ' + FAS.date(f.from)); if (f.to) w.push('s.done_at < ' + FAS.date(f.to) + ' + 1');
            return FAS.rows('SELECT p.tender AS TENDER, COUNT(*) AS N, SUM(p.amount) AS AMOUNT FROM wms_pos_sales s, wms_pos_payments p WHERE ' + w.map(function (x) { return '(' + x + ')'; }).join(' AND ') + ' GROUP BY p.tender ORDER BY SUM(p.amount) DESC', 50);
        },
        shifts: function (f) { f = f || {}; return FAS.rows("SELECT shift_id AS SHIFT_ID, pod AS POD, device_id AS DEVICE_ID, username AS USERNAME, TO_CHAR(opened_at, 'YYYY-MM-DD\"T\"HH24:MI') AS OPENED_AT, float_amt AS FLOAT_AMT, TO_CHAR(closed_at, 'YYYY-MM-DD\"T\"HH24:MI') AS CLOSED_AT, counted AS COUNTED, expected AS EXPECTED, variance AS VARIANCE, sales_n AS SALES_N, net AS NET, status AS STATUS FROM wms_pos_shifts" + (f.pod ? ' WHERE pod = ' + FAS.lit(f.pod) : '') + ' ORDER BY opened_at DESC FETCH FIRST 200 ROWS ONLY', 500); },
        itemsCount: function (pod) { return FAS.rows('SELECT COUNT(*) AS N, SUM(CASE WHEN NVL(active, \'Y\') = \'Y\' THEN 1 ELSE 0 END) AS A, MAX(changed_date) AS M FROM wms_pos_items WHERE pod = ' + FAS.lit(pod), 1).then(function (r) { return r[0] || { N: 0 }; }); },
        customersCount: function (pod) { return FAS.rows('SELECT COUNT(*) AS N FROM wms_pos_customers WHERE pod = ' + FAS.lit(pod), 1).then(function (r) { return r[0] || { N: 0 }; }); },
        items: function (pod, q, max) { return FAS.rows('SELECT item_code AS ITEM_CODE, description AS DESCRIPTION, uom AS UOM, barcode AS BARCODE, list_price AS LIST_PRICE, tax_code AS TAX_CODE, cons AS CONS, crt_price AS CRT_PRICE, crt_min_qty AS CRT_MIN_QTY, category AS CATEGORY, brand AS BRAND, active AS ACTIVE FROM wms_pos_items WHERE pod = ' + FAS.lit(pod) + (q ? " AND (UPPER(item_code) LIKE " + FAS.lit('%' + String(q).toUpperCase() + '%') + ' OR UPPER(description) LIKE ' + FAS.lit('%' + String(q).toUpperCase() + '%') + ' OR barcode LIKE ' + FAS.lit('%' + q + '%') + ')' : '') + ' ORDER BY description FETCH FIRST ' + (max || 300) + ' ROWS ONLY', 1000); },
        /** rows = normalised items (POSE.normItem shape) → MERGE into wms_pos_items of the pod, 25 per statement. */
        mergeItems: function (pod, rows) {
            var chunks = []; for (var i = 0; i < rows.length; i += 25) chunks.push(rows.slice(i, i + 25));
            return chunks.reduce(function (p, c) {
                return p.then(function () {
                    return FAS.write('MERGE INTO wms_pos_items t USING (' + c.map(function (r) {
                        var a = r.attrs || {};
                        return 'SELECT ' + FAS.lit(pod, 20) + ' AS pod, ' + FAS.lit(r.item, 80) + ' AS item_code, ' + FAS.lit(r.desc, 400) + ' AS description, ' + FAS.lit(r.uom, 20) + ' AS uom, ' + FAS.lit(r.barcode, 80) + ' AS barcode, ' + FAS.num(r.price) + ' AS list_price, ' + FAS.lit(r.tax, 40) + ' AS tax_code, ' + FAS.num(r.cons) + ' AS cons, ' + FAS.lit(r.consItem, 80) + ' AS cons_item, ' + FAS.lit(r.crtItem, 80) + ' AS crt_item, ' + FAS.num(r.crtPrice) + ' AS crt_price, ' + FAS.num(r.crtMin) + ' AS crt_min_qty, ' + FAS.num(r.crtDefault) + ' AS crt_default_qty, ' + FAS.lit(a.cat, 120) + ' AS category, ' + FAS.lit(a.subcat, 120) + ' AS sub_category, ' + FAS.lit(a.brand, 120) + ' AS brand, ' + FAS.lit(a.supplier, 200) + ' AS supplier, ' + FAS.lit(a.pc, 120) + ' AS profit_center, ' + FAS.lit(a.group, 120) + ' AS group_code, ' + FAS.lit(r.itemType, 60) + ' AS item_type, ' + FAS.lit(r.image, 600) + ' AS image_url, ' + FAS.lit(r.active === false ? 'N' : 'Y') + ' AS active FROM dual';
                    }).join(' UNION ALL ') + ') s ON (t.pod = s.pod AND t.item_code = s.item_code) WHEN MATCHED THEN UPDATE SET description = s.description, uom = s.uom, barcode = s.barcode, list_price = s.list_price, tax_code = s.tax_code, cons = s.cons, cons_item = s.cons_item, crt_item = s.crt_item, crt_price = s.crt_price, crt_min_qty = s.crt_min_qty, crt_default_qty = s.crt_default_qty, category = s.category, sub_category = s.sub_category, brand = s.brand, supplier = s.supplier, profit_center = s.profit_center, group_code = s.group_code, item_type = s.item_type, image_url = s.image_url, active = s.active, changed_date = SYSDATE' +
                        ' WHEN NOT MATCHED THEN INSERT (pod, item_code, description, uom, barcode, list_price, tax_code, cons, cons_item, crt_item, crt_price, crt_min_qty, crt_default_qty, category, sub_category, brand, supplier, profit_center, group_code, item_type, image_url, active, changed_date) VALUES (s.pod, s.item_code, s.description, s.uom, s.barcode, s.list_price, s.tax_code, s.cons, s.cons_item, s.crt_item, s.crt_price, s.crt_min_qty, s.crt_default_qty, s.category, s.sub_category, s.brand, s.supplier, s.profit_center, s.group_code, s.item_type, s.image_url, s.active, SYSDATE)');
                });
            }, Promise.resolve()).then(function () { return rows.length; });
        },
        mergeCustomers: function (pod, rows) {
            var chunks = []; for (var i = 0; i < rows.length; i += 30) chunks.push(rows.slice(i, i + 30));
            return chunks.reduce(function (p, c) {
                return p.then(function () {
                    return FAS.write('MERGE INTO wms_pos_customers t USING (' + c.map(function (r) {
                        return 'SELECT ' + FAS.lit(pod, 20) + ' AS pod, ' + FAS.lit(r.number, 80) + ' AS customer_number, ' + FAS.lit(r.name, 300) + ' AS customer_name, ' + FAS.lit(r.category, 120) + ' AS category, ' + FAS.lit(r.type, 120) + ' AS customer_class, ' + FAS.num(r.credit) + ' AS credit_limit, ' + FAS.lit(r.vat, 60) + ' AS vat, ' + FAS.lit(r.brn, 60) + ' AS brn, ' + FAS.lit(r.phone, 60) + ' AS phone, ' + FAS.lit(r.address, 600) + ' AS address, ' + FAS.lit(r.priceList, 120) + ' AS price_list FROM dual';
                    }).join(' UNION ALL ') + ') s ON (t.pod = s.pod AND t.customer_number = s.customer_number) WHEN MATCHED THEN UPDATE SET customer_name = s.customer_name, category = s.category, customer_class = s.customer_class, credit_limit = s.credit_limit, vat = s.vat, brn = s.brn, phone = s.phone, address = s.address, price_list = s.price_list, active = \'Y\', changed_date = SYSDATE' +
                        ' WHEN NOT MATCHED THEN INSERT (pod, customer_number, customer_name, category, customer_class, credit_limit, vat, brn, phone, address, price_list, active, changed_date) VALUES (s.pod, s.customer_number, s.customer_name, s.category, s.customer_class, s.credit_limit, s.vat, s.brn, s.phone, s.address, s.price_list, \'Y\', SYSDATE)');
                });
            }, Promise.resolve()).then(function () { return rows.length; });
        }
    };

    // ── photos ────────────────────────────────────────────────────
    FAS.photos = {
        list: function (f) {
            f = f || {}; var w = [];
            if (f.app) w.push('app_id = ' + FAS.lit(f.app)); if (f.trip) w.push('trip_id = ' + FAS.lit(f.trip)); if (f.user) w.push('UPPER(username) = ' + FAS.lit(String(f.user).toUpperCase()));
            if (f.from) w.push('taken_at >= ' + FAS.date(f.from)); if (f.to) w.push('taken_at < ' + FAS.date(f.to) + ' + 1');
            return FAS.rows("SELECT photo_id AS PHOTO_ID, app_id AS APP_ID, sub_id AS SUB_ID, username AS USERNAME, device_id AS DEVICE_ID, TO_CHAR(taken_at, 'YYYY-MM-DD\"T\"HH24:MI') AS TAKEN, lat AS LAT, lng AS LNG, trip_id AS TRIP_ID, bay AS BAY, ref1 AS REF1, ref2 AS REF2, note AS NOTE, mime AS MIME, bytes AS BYTES, width AS WIDTH, height AS HEIGHT, vision_op AS VISION_OP, vision_count AS VISION_COUNT, expected_count AS EXPECTED_COUNT, TO_CHAR(vision_at, 'YYYY-MM-DD\"T\"HH24:MI') AS VISION_AT, vision_by AS VISION_BY FROM wms_field_photos" + (w.length ? ' WHERE ' + w.join(' AND ') : '') + ' ORDER BY taken_at DESC FETCH FIRST ' + (f.max || 200) + ' ROWS ONLY', 1000);
        },
        url: function (id, key) { return FAS.WM + '/field/photos/' + encodeURIComponent(id) + '?k=' + encodeURIComponent(key || ''); },
        /** The picture as a data URL (through the host, with this desktop's device key). */
        image: function (id) {
            return FAS.device.ensure().then(function (d) { return FAS.hostOk('fieldAppFetch', { url: FAS.photos.url(id, d.key) }, 180000); }).then(function (r) { return 'data:' + (r.mime || 'image/jpeg') + ';base64,' + r.base64; });
        },
        vision: function (id) { return FAS.readClob('wms_field_photos', 'vision_json', 'photo_id', [id]).then(function (m) { try { return JSON.parse(m[id] || 'null'); } catch (e) { return null; } }); },
        saveVision: function (id, op, result, count) {
            return FAS.write('UPDATE wms_field_photos SET vision_op = ' + FAS.lit(op, 30) + ', vision_at = SYSDATE, vision_by = ' + FAS.lit(FAS.user()) + ', vision_count = ' + FAS.num(count) + ' WHERE photo_id = ' + FAS.lit(id))
                .then(function () { return FAS.writeClob('wms_field_photos', 'vision_json', 'photo_id = ' + FAS.lit(id), JSON.stringify(result || null)); });
        },
        setExpected: function (id, n) { return FAS.write('UPDATE wms_field_photos SET expected_count = ' + FAS.num(n) + ' WHERE photo_id = ' + FAS.lit(id)); },
        /** Upload a picture through the handler like a phone (desktop preview). meta = {id, app, sub, trip, bay, ref1, ref2, lat, lng, taken, note, width, height, expected} */
        upload: function (dataUrl, meta) {
            return FAS.device.ensure().then(function (d) {
                var mime = (/^data:([^;]+)/.exec(dataUrl) || [])[1] || 'image/jpeg';
                return FAS.hostOk('fieldAppUpload', { url: FAS.WM + '/field/photos?k=' + encodeURIComponent(d.key) + '&m=' + encodeURIComponent(JSON.stringify(Object.assign({ mime: mime }, meta || {}))), base64: dataUrl, mime: mime }, 300000);
            }).then(function (r) { var j = null; try { j = JSON.parse(r.body || 'null'); } catch (e) { } if (!j || j.ok === false) throw new Error((j && j.error) || 'Upload failed'); return j; });
        }
    };

    // ── mobile users (who can be given an app) ────────────────────
    FAS.mobileUsers = function () {
        return FAS.rows("SELECT table_name AS T FROM user_tables WHERE table_name IN ('GR_MOBILE_USER', 'GR_MOBILE_USERS')", 5).then(function (r) {
            if (!r.length) return [];
            var t = r[0].T;
            return FAS.rows("SELECT column_name AS C FROM user_tab_columns WHERE table_name = " + FAS.lit(t) + " ORDER BY column_id", 200).then(function (cols) {
                var names = cols.map(function (c) { return c.C; });
                var ucol = names.filter(function (c) { return /^(USERNAME|USER_NAME|LOGIN|USER_ID)$/.test(c); })[0] || names.filter(function (c) { return /USER/.test(c) && !/PASS|TYPE/.test(c); })[0];
                var tcol = names.filter(function (c) { return /USER_TYPE|USERTYPE|ROLE|TYPE/.test(c); })[0];
                var ncol = names.filter(function (c) { return /PICKER_NAME|FULL_NAME|DISPLAY_NAME|NAME/.test(c) && !/USER/.test(c); })[0];
                if (!ucol) return [];
                return FAS.rows('SELECT DISTINCT ' + ucol + ' AS U' + (tcol ? ', ' + tcol + ' AS T' : '') + (ncol ? ', ' + ncol + ' AS N' : '') + ' FROM ' + t + ' ORDER BY ' + ucol, 1000).then(function (rows) { return rows.map(function (x) { return { username: String(x.U || ''), type: x.T || '', name: x.N || '' }; }).filter(function (x) { return x.username; }); });
            });
        }).catch(function () { return []; });
    };
})(typeof window !== 'undefined' ? window : this);
