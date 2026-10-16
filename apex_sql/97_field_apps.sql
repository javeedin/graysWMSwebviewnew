-- =====================================================================
-- 97_field_apps.sql — Field Apps: apps made on the desktop, run on the pickers' phones
--
-- Part 1  Tables (the Field Apps page creates these itself on first use — same DDL)
-- Part 2  Procedures the phone handlers call (pair, ping, apps, app, query, submit, photos,
--         and the POS unpack of a submitted sale / shift)
-- Part 3  ORDS handlers under the WAREHOUSEMANAGEMENT module:
--           POST field/pair        one-time pairing code → device key (shown once)
--           GET  field/ping?k=     who am I, server time
--           GET  field/apps?k=     the published apps of the device's user (manifest, signature — no code)
--           GET  field/apps/:id?k= one app with its code
--           POST field/query?k=    {app, name, params} → the named read-only query (stored in APEX, never SQL from the phone)
--           POST field/submit?k=   {subId, app, kind, ref, amount, doc} → stored raw; pos_sale / pos_shift unpacked into the POS tables
--           POST field/photos?k=&m= the JPEG as the body, metadata JSON in m
--           GET  field/photos/:id?k= the picture
--
-- Run as the workspace schema (SQL Developer / APEX SQL Workshop). Parts 2 and 3 cannot run through
-- the app's ai/executewrite gateway (it refuses PL/SQL blocks), so the page asks for this script when
-- field/ping does not answer. Column names avoid the words the ai/executequery gateway refuses.
-- Every device key is kept as SHA-256 only. Apps are signed on the desktop (ECDSA P-256); the phone
-- verifies them with the public keys in WMS_FIELD_SETTINGS (skey = 'signing_keys') — the database is
-- not the trust boundary, the signature is.
-- =====================================================================

-- ───────────────────────────── Part 1 · tables ─────────────────────────────
DECLARE
    PROCEDURE mk (p_table VARCHAR2, p_ddl VARCHAR2) IS
        n PLS_INTEGER;
    BEGIN
        SELECT COUNT(*) INTO n FROM user_tables WHERE table_name = UPPER(p_table);
        IF n = 0 THEN EXECUTE IMMEDIATE p_ddl; DBMS_OUTPUT.put_line('created ' || p_table); END IF;
    END;
BEGIN
    mk('WMS_FIELD_APPS', 'CREATE TABLE wms_field_apps (app_id VARCHAR2(60) PRIMARY KEY, name VARCHAR2(200), kind VARCHAR2(10) DEFAULT ''CODE'', version NUMBER DEFAULT 1, status VARCHAR2(12) DEFAULT ''DRAFT'', pod VARCHAR2(20), icon VARCHAR2(16), manifest_json CLOB, code CLOB, code_sha256 VARCHAR2(64), manifest_sha256 VARCHAR2(64), signature VARCHAR2(200), key_id VARCHAR2(16), code_bytes NUMBER, expires_at DATE, notes VARCHAR2(1000), created_by VARCHAR2(100), created_date DATE DEFAULT SYSDATE, changed_by VARCHAR2(100), changed_date DATE, published_by VARCHAR2(100), published_date DATE)');
    mk('WMS_FIELD_APP_USERS', 'CREATE TABLE wms_field_app_users (app_id VARCHAR2(60), username VARCHAR2(100), added_by VARCHAR2(100), added_date DATE DEFAULT SYSDATE, PRIMARY KEY (app_id, username))');
    mk('WMS_FIELD_QUERIES', 'CREATE TABLE wms_field_queries (app_id VARCHAR2(60), qname VARCHAR2(60), sql_text CLOB, max_rows NUMBER DEFAULT 5000, notes VARCHAR2(400), changed_by VARCHAR2(100), changed_date DATE, PRIMARY KEY (app_id, qname))');
    mk('WMS_FIELD_DEVICES', 'CREATE TABLE wms_field_devices (device_id VARCHAR2(80) PRIMARY KEY, label VARCHAR2(200), username VARCHAR2(100), platform VARCHAR2(40), app_version VARCHAR2(40), key_hash VARCHAR2(64), paired_at DATE, paired_by VARCHAR2(100), last_seen DATE, revoked VARCHAR2(1) DEFAULT ''N'', revoked_by VARCHAR2(100), revoked_date DATE, revoke_reason VARCHAR2(400))');
    mk('WMS_FIELD_PAIRINGS', 'CREATE TABLE wms_field_pairings (code_hash VARCHAR2(64) PRIMARY KEY, username VARCHAR2(100), label VARCHAR2(200), created_by VARCHAR2(100), created_date DATE DEFAULT SYSDATE, expires_at DATE, used_at DATE, device_id VARCHAR2(80))');
    mk('WMS_FIELD_SUBMISSIONS', 'CREATE TABLE wms_field_submissions (sub_id VARCHAR2(80) PRIMARY KEY, app_id VARCHAR2(60), kind VARCHAR2(40), username VARCHAR2(100), device_id VARCHAR2(80), doc_ref VARCHAR2(120), amount NUMBER, status VARCHAR2(12) DEFAULT ''NEW'', doc_json CLOB, error_text VARCHAR2(2000), created_date DATE DEFAULT SYSDATE, processed_date DATE)');
    mk('WMS_FIELD_PHOTOS', 'CREATE TABLE wms_field_photos (photo_id VARCHAR2(80) PRIMARY KEY, app_id VARCHAR2(60), sub_id VARCHAR2(80), username VARCHAR2(100), device_id VARCHAR2(80), taken_at DATE, lat NUMBER, lng NUMBER, trip_id VARCHAR2(40), bay VARCHAR2(60), ref1 VARCHAR2(120), ref2 VARCHAR2(120), note VARCHAR2(1000), mime VARCHAR2(60), bytes NUMBER, sha256 VARCHAR2(64), width NUMBER, height NUMBER, image BLOB, vision_op VARCHAR2(30), vision_json CLOB, vision_at DATE, vision_by VARCHAR2(100), vision_count NUMBER, expected_count NUMBER, created_date DATE DEFAULT SYSDATE)');
    mk('WMS_FIELD_SETTINGS', 'CREATE TABLE wms_field_settings (skey VARCHAR2(60) PRIMARY KEY, val_json CLOB, changed_by VARCHAR2(100), changed_date DATE)');
    mk('WMS_POS_ITEMS', 'CREATE TABLE wms_pos_items (pod VARCHAR2(20), item_code VARCHAR2(80), description VARCHAR2(400), uom VARCHAR2(20), barcode VARCHAR2(80), list_price NUMBER, currency VARCHAR2(10), tax_code VARCHAR2(40), cons NUMBER, cons_item VARCHAR2(80), crt_item VARCHAR2(80), crt_price NUMBER, crt_min_qty NUMBER, crt_default_qty NUMBER, category VARCHAR2(120), sub_category VARCHAR2(120), brand VARCHAR2(120), supplier VARCHAR2(200), profit_center VARCHAR2(120), group_code VARCHAR2(120), item_type VARCHAR2(60), image_url VARCHAR2(600), active VARCHAR2(1) DEFAULT ''Y'', changed_date DATE DEFAULT SYSDATE, PRIMARY KEY (pod, item_code))');
    mk('WMS_POS_CUSTOMERS', 'CREATE TABLE wms_pos_customers (pod VARCHAR2(20), customer_number VARCHAR2(80), customer_name VARCHAR2(300), category VARCHAR2(120), customer_class VARCHAR2(120), credit_limit NUMBER, vat VARCHAR2(60), brn VARCHAR2(60), phone VARCHAR2(60), address VARCHAR2(600), price_list VARCHAR2(120), active VARCHAR2(1) DEFAULT ''Y'', changed_date DATE DEFAULT SYSDATE, PRIMARY KEY (pod, customer_number))');
    mk('WMS_POS_SHIFTS', 'CREATE TABLE wms_pos_shifts (shift_id VARCHAR2(80) PRIMARY KEY, pod VARCHAR2(20), device_id VARCHAR2(80), username VARCHAR2(100), opened_at DATE, float_amt NUMBER, closed_at DATE, counted NUMBER, expected NUMBER, variance NUMBER, sales_n NUMBER, net NUMBER, status VARCHAR2(12), doc_json CLOB, created_date DATE DEFAULT SYSDATE)');
    mk('WMS_POS_SALES', 'CREATE TABLE wms_pos_sales (sale_id VARCHAR2(80) PRIMARY KEY, sale_number VARCHAR2(60), kind VARCHAR2(10), status VARCHAR2(12), pod VARCHAR2(20), shift_id VARCHAR2(80), device_id VARCHAR2(80), username VARCHAR2(100), customer_number VARCHAR2(80), customer_name VARCHAR2(300), opened_at DATE, done_at DATE, gross NUMBER, disc NUMBER, tax NUMBER, cons NUMBER, crates NUMBER, net NUMBER, rounded NUMBER, paid NUMBER, change_amt NUMBER, lines_n NUMBER, units NUMBER, return_of VARCHAR2(80), mra_status VARCHAR2(20), mra_irn VARCHAR2(120), fusion_order VARCHAR2(60), lat NUMBER, lng NUMBER, note VARCHAR2(1000), doc_json CLOB, created_date DATE DEFAULT SYSDATE)');
    mk('WMS_POS_SALE_LINES', 'CREATE TABLE wms_pos_sale_lines (sale_id VARCHAR2(80), line_no NUMBER, line_id VARCHAR2(80), item_code VARCHAR2(80), description VARCHAR2(400), uom VARCHAR2(20), barcode VARCHAR2(80), qty NUMBER, list_price NUMBER, sell_price NUMBER, disc_pct NUMBER, disc_cust NUMBER, disc_mkt NUMBER, disc_add NUMBER, tax_code VARCHAR2(40), tax_pct NUMBER, gross NUMBER, tax NUMBER, cons NUMBER, crates NUMBER, crate_qty NUMBER, net NUMBER, line_type VARCHAR2(10), return_of_line VARCHAR2(80), note VARCHAR2(400), PRIMARY KEY (sale_id, line_no))');
    mk('WMS_POS_PAYMENTS', 'CREATE TABLE wms_pos_payments (sale_id VARCHAR2(80), seq NUMBER, tender VARCHAR2(20), amount NUMBER, pay_ref VARCHAR2(120), paid_at DATE, PRIMARY KEY (sale_id, seq))');
END;
/

-- ──────────────────────────── Part 2 · procedures ──────────────────────────

-- Small JSON helpers: every handler answers JSON; errors carry an HTTP status.
CREATE OR REPLACE PROCEDURE wms_field_fail (p_status PLS_INTEGER, p_msg VARCHAR2) IS
BEGIN
    owa_util.status_line(p_status, NULL, FALSE);
    owa_util.mime_header('application/json', TRUE, 'UTF-8');
    htp.p('{"ok":false,"error":"' || REPLACE(REPLACE(p_msg, '\', '\\'), '"', '\"') || '"}');
END;
/

-- The device behind a key (hashed), or NULL. Updates last_seen.
CREATE OR REPLACE FUNCTION wms_field_auth (p_key VARCHAR2, o_device OUT VARCHAR2, o_user OUT VARCHAR2) RETURN BOOLEAN IS
    v_hash VARCHAR2(64);
BEGIN
    IF p_key IS NULL OR LENGTH(p_key) < 20 THEN RETURN FALSE; END IF;
    SELECT RAWTOHEX(STANDARD_HASH(p_key, 'SHA256')) INTO v_hash FROM dual;
    SELECT device_id, username INTO o_device, o_user FROM wms_field_devices WHERE key_hash = v_hash AND NVL(revoked, 'N') = 'N';
    UPDATE wms_field_devices SET last_seen = SYSDATE WHERE device_id = o_device;
    COMMIT;
    RETURN TRUE;
EXCEPTION WHEN NO_DATA_FOUND THEN RETURN FALSE;
END;
/

-- Random key: DBMS_CRYPTO when the schema may use it, else two GUIDs.
CREATE OR REPLACE FUNCTION wms_field_random_key RETURN VARCHAR2 IS
    v VARCHAR2(120);
BEGIN
    BEGIN
        EXECUTE IMMEDIATE 'SELECT LOWER(RAWTOHEX(DBMS_CRYPTO.RANDOMBYTES(24))) FROM dual' INTO v;
    EXCEPTION WHEN OTHERS THEN
        v := LOWER(RAWTOHEX(SYS_GUID())) || LOWER(RAWTOHEX(SYS_GUID()));
    END;
    RETURN 'fk_' || v;
END;
/

-- The signing public keys (what the desktop published) as a JSON array text.
CREATE OR REPLACE FUNCTION wms_field_keys_json RETURN CLOB IS
    v CLOB;
BEGIN
    SELECT val_json INTO v FROM wms_field_settings WHERE skey = 'signing_keys';
    RETURN NVL(v, '[]');
EXCEPTION WHEN NO_DATA_FOUND THEN RETURN '[]';
END;
/

-- POST field/pair  {code, label, platform, appVersion, deviceId?} → {ok, deviceId, key, username, keys}
CREATE OR REPLACE PROCEDURE wms_field_pair (p_body CLOB) IS
    v_code  VARCHAR2(200) := JSON_VALUE(p_body, '$.code');
    v_label VARCHAR2(200) := SUBSTR(JSON_VALUE(p_body, '$.label'), 1, 200);
    v_plat  VARCHAR2(40)  := SUBSTR(JSON_VALUE(p_body, '$.platform'), 1, 40);
    v_ver   VARCHAR2(40)  := SUBSTR(JSON_VALUE(p_body, '$.appVersion'), 1, 40);
    v_dev   VARCHAR2(80)  := SUBSTR(JSON_VALUE(p_body, '$.deviceId'), 1, 80);
    v_hash  VARCHAR2(64);
    v_user  VARCHAR2(100);
    v_plabel VARCHAR2(200);
    v_key   VARCHAR2(120);
BEGIN
    IF v_code IS NULL OR LENGTH(v_code) < 6 THEN wms_field_fail(400, 'Pairing code missing'); RETURN; END IF;
    SELECT RAWTOHEX(STANDARD_HASH(UPPER(TRIM(v_code)), 'SHA256')) INTO v_hash FROM dual;
    BEGIN
        SELECT username, label INTO v_user, v_plabel FROM wms_field_pairings
         WHERE code_hash = v_hash AND used_at IS NULL AND expires_at > SYSDATE;
    EXCEPTION WHEN NO_DATA_FOUND THEN wms_field_fail(401, 'This pairing code is unknown, used or expired - show a new one on the desktop'); RETURN;
    END;
    v_key := wms_field_random_key();
    IF v_dev IS NULL THEN v_dev := 'dev_' || LOWER(RAWTOHEX(SYS_GUID())); END IF;
    MERGE INTO wms_field_devices d USING (SELECT v_dev AS device_id FROM dual) s ON (d.device_id = s.device_id)
    WHEN MATCHED THEN UPDATE SET label = NVL(v_label, v_plabel), username = v_user, platform = v_plat, app_version = v_ver,
        key_hash = RAWTOHEX(STANDARD_HASH(v_key, 'SHA256')), paired_at = SYSDATE, last_seen = SYSDATE, revoked = 'N', revoked_by = NULL, revoked_date = NULL, revoke_reason = NULL
    WHEN NOT MATCHED THEN INSERT (device_id, label, username, platform, app_version, key_hash, paired_at, paired_by, last_seen, revoked)
        VALUES (v_dev, NVL(v_label, v_plabel), v_user, v_plat, v_ver, RAWTOHEX(STANDARD_HASH(v_key, 'SHA256')), SYSDATE, v_user, SYSDATE, 'N');
    UPDATE wms_field_pairings SET used_at = SYSDATE, device_id = v_dev WHERE code_hash = v_hash;
    COMMIT;
    owa_util.mime_header('application/json', TRUE, 'UTF-8');
    apex_json.open_object;
    apex_json.write('ok', TRUE);
    apex_json.write('deviceId', v_dev);
    apex_json.write('key', v_key);
    apex_json.write('username', v_user);
    apex_json.write('keys', wms_field_keys_json());
    apex_json.write('serverTime', TO_CHAR(SYSDATE, 'YYYY-MM-DD"T"HH24:MI:SS'));
    apex_json.close_object;
END;
/

-- GET field/ping?k=
CREATE OR REPLACE PROCEDURE wms_field_ping (p_key VARCHAR2) IS
    v_dev VARCHAR2(80); v_user VARCHAR2(100); n PLS_INTEGER;
BEGIN
    IF NOT wms_field_auth(p_key, v_dev, v_user) THEN wms_field_fail(401, 'Unknown or revoked device key - pair this phone again'); RETURN; END IF;
    SELECT COUNT(*) INTO n FROM wms_field_apps a
     WHERE a.status = 'PUBLISHED' AND (a.expires_at IS NULL OR a.expires_at > SYSDATE)
       AND EXISTS (SELECT 1 FROM wms_field_app_users u WHERE u.app_id = a.app_id AND (u.username = '*' OR UPPER(u.username) = UPPER(v_user)));
    owa_util.mime_header('application/json', TRUE, 'UTF-8');
    apex_json.open_object;
    apex_json.write('ok', TRUE); apex_json.write('deviceId', v_dev); apex_json.write('username', v_user); apex_json.write('apps', n);
    apex_json.write('serverTime', TO_CHAR(SYSDATE, 'YYYY-MM-DD"T"HH24:MI:SS'));
    apex_json.close_object;
END;
/

-- GET field/apps?k=  (manifests + signatures; no code)
CREATE OR REPLACE PROCEDURE wms_field_apps_list (p_key VARCHAR2) IS
    v_dev VARCHAR2(80); v_user VARCHAR2(100);
    CURSOR c IS
        SELECT a.app_id, a.name, a.kind, a.version, a.pod, a.icon, a.manifest_json, a.code_sha256, a.manifest_sha256, a.signature, a.key_id, a.code_bytes,
               TO_CHAR(a.expires_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS expires_at, TO_CHAR(NVL(a.published_date, a.changed_date), 'YYYY-MM-DD"T"HH24:MI:SS') AS published_at
          FROM wms_field_apps a
         WHERE a.status = 'PUBLISHED' AND (a.expires_at IS NULL OR a.expires_at > SYSDATE)
           AND EXISTS (SELECT 1 FROM wms_field_app_users u WHERE u.app_id = a.app_id AND (u.username = '*' OR UPPER(u.username) = UPPER(v_user)))
         ORDER BY a.name;
BEGIN
    IF NOT wms_field_auth(p_key, v_dev, v_user) THEN wms_field_fail(401, 'Unknown or revoked device key - pair this phone again'); RETURN; END IF;
    owa_util.mime_header('application/json', TRUE, 'UTF-8');
    apex_json.open_object;
    apex_json.write('ok', TRUE); apex_json.write('username', v_user); apex_json.write('deviceId', v_dev);
    apex_json.write('serverTime', TO_CHAR(SYSDATE, 'YYYY-MM-DD"T"HH24:MI:SS'));
    apex_json.write('keys', wms_field_keys_json());
    apex_json.open_array('items');
    FOR r IN c LOOP
        apex_json.open_object;
        apex_json.write('appId', r.app_id); apex_json.write('name', r.name); apex_json.write('kind', r.kind); apex_json.write('version', r.version);
        apex_json.write('pod', r.pod); apex_json.write('icon', r.icon); apex_json.write('manifest', r.manifest_json);
        apex_json.write('codeSha256', r.code_sha256); apex_json.write('manifestSha256', r.manifest_sha256); apex_json.write('signature', r.signature);
        apex_json.write('keyId', r.key_id); apex_json.write('codeBytes', r.code_bytes); apex_json.write('expiresAt', r.expires_at); apex_json.write('publishedAt', r.published_at);
        apex_json.close_object;
    END LOOP;
    apex_json.close_array;
    apex_json.close_object;
END;
/

-- GET field/apps/:id?k=  (one app with its code)
CREATE OR REPLACE PROCEDURE wms_field_app_get (p_key VARCHAR2, p_id VARCHAR2) IS
    v_dev VARCHAR2(80); v_user VARCHAR2(100);
    r wms_field_apps%ROWTYPE;
    n PLS_INTEGER;
BEGIN
    IF NOT wms_field_auth(p_key, v_dev, v_user) THEN wms_field_fail(401, 'Unknown or revoked device key - pair this phone again'); RETURN; END IF;
    BEGIN
        SELECT * INTO r FROM wms_field_apps WHERE app_id = p_id;
    EXCEPTION WHEN NO_DATA_FOUND THEN wms_field_fail(404, 'No such app'); RETURN;
    END;
    SELECT COUNT(*) INTO n FROM wms_field_app_users u WHERE u.app_id = p_id AND (u.username = '*' OR UPPER(u.username) = UPPER(v_user));
    IF r.status <> 'PUBLISHED' OR n = 0 OR (r.expires_at IS NOT NULL AND r.expires_at <= SYSDATE) THEN wms_field_fail(403, 'This app is not published to you'); RETURN; END IF;
    owa_util.mime_header('application/json', TRUE, 'UTF-8');
    apex_json.open_object;
    apex_json.write('ok', TRUE);
    apex_json.write('appId', r.app_id); apex_json.write('name', r.name); apex_json.write('kind', r.kind); apex_json.write('version', r.version);
    apex_json.write('pod', r.pod); apex_json.write('icon', r.icon); apex_json.write('manifest', r.manifest_json); apex_json.write('code', r.code);
    apex_json.write('codeSha256', r.code_sha256); apex_json.write('manifestSha256', r.manifest_sha256); apex_json.write('signature', r.signature);
    apex_json.write('keyId', r.key_id); apex_json.write('codeBytes', r.code_bytes);
    apex_json.write('expiresAt', TO_CHAR(r.expires_at, 'YYYY-MM-DD"T"HH24:MI:SS'));
    apex_json.write('keys', wms_field_keys_json());
    apex_json.close_object;
END;
/

-- POST field/query?k=  {app, name, params:{...}} → {ok, items:[...]}
-- The SQL is the one stored for the app (SELECT / WITH, one statement); {{NAME}} placeholders are
-- filled with the parameters as quoted literals, plus {{USER}} {{DEVICE}}. Row cap = max_rows (≤ 50,000).
CREATE OR REPLACE PROCEDURE wms_field_query (p_key VARCHAR2, p_body CLOB) IS
    v_dev VARCHAR2(80); v_user VARCHAR2(100);
    v_app  VARCHAR2(60) := JSON_VALUE(p_body, '$.app');
    v_name VARCHAR2(60) := JSON_VALUE(p_body, '$.name');
    v_sql  CLOB; v_max NUMBER; v_scan CLOB; v_cur SYS_REFCURSOR; v_ok PLS_INTEGER;
    v_members apex_t_varchar2;
    v_val VARCHAR2(4000);
    v_start TIMESTAMP := SYSTIMESTAMP;
BEGIN
    IF NOT wms_field_auth(p_key, v_dev, v_user) THEN wms_field_fail(401, 'Unknown or revoked device key - pair this phone again'); RETURN; END IF;
    SELECT COUNT(*) INTO v_ok FROM wms_field_app_users u WHERE u.app_id = v_app AND (u.username = '*' OR UPPER(u.username) = UPPER(v_user));
    IF v_ok = 0 THEN wms_field_fail(403, 'This app is not published to you'); RETURN; END IF;
    BEGIN
        SELECT sql_text, LEAST(NVL(max_rows, 5000), 50000) INTO v_sql, v_max FROM wms_field_queries WHERE app_id = v_app AND qname = v_name;
    EXCEPTION WHEN NO_DATA_FOUND THEN wms_field_fail(404, 'No query "' || v_name || '" for this app'); RETURN;
    END;
    v_sql := TRIM(v_sql);
    v_scan := UPPER(REGEXP_REPLACE(v_sql, q'{'([^']|'')*'}', q'{'X'}', 1, 0, 'n'));
    IF v_scan IS NULL OR NOT REGEXP_LIKE(v_scan, '^\s*(SELECT|WITH)\W') OR INSTR(v_scan, ';') > 0
       OR REGEXP_LIKE(v_scan, '(^|\W)(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|EXECUTE|BEGIN|DECLARE|CALL|LOCK|COMMIT|ROLLBACK)(\W|$)')
       OR REGEXP_LIKE(v_scan, '(^|\W)(DBMS_|UTL_)') THEN
        wms_field_fail(400, 'The stored query is not a single read-only SELECT'); RETURN;
    END IF;
    -- placeholders
    v_sql := REPLACE(v_sql, '{{USER}}', '''' || REPLACE(v_user, '''', '''''') || '''');
    v_sql := REPLACE(v_sql, '{{DEVICE}}', '''' || REPLACE(v_dev, '''', '''''') || '''');
    BEGIN
        apex_json.parse(p_body);
        v_members := apex_json.get_members(p_path => 'params');
        IF v_members IS NOT NULL THEN
            FOR i IN 1 .. v_members.COUNT LOOP
                IF REGEXP_LIKE(v_members(i), '^[A-Za-z0-9_]{1,40}$') THEN
                    v_val := SUBSTR(apex_json.get_varchar2(p_path => 'params.' || v_members(i)), 1, 2000);
                    v_sql := REPLACE(v_sql, '{{' || UPPER(v_members(i)) || '}}', CASE WHEN v_val IS NULL THEN 'NULL' ELSE '''' || REPLACE(v_val, '''', '''''') || '''' END);
                END IF;
            END LOOP;
        END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    v_sql := REGEXP_REPLACE(v_sql, '\{\{[A-Za-z0-9_]+\}\}', 'NULL');     -- placeholders nobody filled
    OPEN v_cur FOR 'SELECT * FROM (' || v_sql || ') FETCH FIRST ' || v_max || ' ROWS ONLY';
    owa_util.mime_header('application/json', TRUE, 'UTF-8');
    apex_json.open_object;
    apex_json.write('ok', TRUE);
    apex_json.write('name', v_name);
    apex_json.write('items', v_cur);
    apex_json.write('ms', ROUND(EXTRACT(SECOND FROM (SYSTIMESTAMP - v_start)) * 1000));
    apex_json.close_object;
EXCEPTION WHEN OTHERS THEN
    wms_field_fail(500, SUBSTR(SQLERRM, 1, 300));
END;
/

-- A submitted POS sale (doc = the engine's sale document) → wms_pos_sales / _sale_lines / _payments.
CREATE OR REPLACE PROCEDURE wms_pos_unpack_sale (p_sub_id VARCHAR2) IS
    v_doc CLOB; v_pod VARCHAR2(20); v_user VARCHAR2(100); v_dev VARCHAR2(80);
    v_sale VARCHAR2(80);
BEGIN
    SELECT doc_json, username, device_id INTO v_doc, v_user, v_dev FROM wms_field_submissions WHERE sub_id = p_sub_id;
    v_sale := JSON_VALUE(v_doc, '$.saleId');
    IF v_sale IS NULL THEN RAISE_APPLICATION_ERROR(-20001, 'saleId missing'); END IF;
    DELETE FROM wms_pos_sale_lines WHERE sale_id = v_sale;
    DELETE FROM wms_pos_payments WHERE sale_id = v_sale;
    MERGE INTO wms_pos_sales t USING (SELECT v_sale AS sale_id FROM dual) s ON (t.sale_id = s.sale_id)
    WHEN MATCHED THEN UPDATE SET
        sale_number = JSON_VALUE(v_doc, '$.number'), kind = JSON_VALUE(v_doc, '$.kind'), status = JSON_VALUE(v_doc, '$.status'),
        pod = JSON_VALUE(v_doc, '$.pod'), shift_id = JSON_VALUE(v_doc, '$.shiftId'), device_id = NVL(JSON_VALUE(v_doc, '$.device'), v_dev), username = NVL(JSON_VALUE(v_doc, '$.user'), v_user),
        customer_number = JSON_VALUE(v_doc, '$.customer.number'), customer_name = JSON_VALUE(v_doc, '$.customer.name'),
        opened_at = TO_DATE(SUBSTR(JSON_VALUE(v_doc, '$.openedAt'), 1, 19), 'YYYY-MM-DD"T"HH24:MI:SS'), done_at = TO_DATE(SUBSTR(JSON_VALUE(v_doc, '$.doneAt'), 1, 19), 'YYYY-MM-DD"T"HH24:MI:SS'),
        gross = JSON_VALUE(v_doc, '$.totals.gross' RETURNING NUMBER), disc = JSON_VALUE(v_doc, '$.totals.disc' RETURNING NUMBER), tax = JSON_VALUE(v_doc, '$.totals.tax' RETURNING NUMBER),
        cons = JSON_VALUE(v_doc, '$.totals.cons' RETURNING NUMBER), crates = JSON_VALUE(v_doc, '$.totals.crates' RETURNING NUMBER), net = JSON_VALUE(v_doc, '$.totals.net' RETURNING NUMBER),
        rounded = JSON_VALUE(v_doc, '$.totals.rounded' RETURNING NUMBER), paid = JSON_VALUE(v_doc, '$.totals.paid' RETURNING NUMBER), change_amt = JSON_VALUE(v_doc, '$.totals.change' RETURNING NUMBER),
        lines_n = JSON_VALUE(v_doc, '$.totals.items' RETURNING NUMBER), units = JSON_VALUE(v_doc, '$.totals.units' RETURNING NUMBER), return_of = JSON_VALUE(v_doc, '$.returnOf.saleId'),
        mra_status = JSON_VALUE(v_doc, '$.mra.status'), lat = JSON_VALUE(v_doc, '$.gps.lat' RETURNING NUMBER), lng = JSON_VALUE(v_doc, '$.gps.lng' RETURNING NUMBER), note = SUBSTR(JSON_VALUE(v_doc, '$.note'), 1, 1000), doc_json = v_doc
    WHEN NOT MATCHED THEN INSERT (sale_id, sale_number, kind, status, pod, shift_id, device_id, username, customer_number, customer_name, opened_at, done_at, gross, disc, tax, cons, crates, net, rounded, paid, change_amt, lines_n, units, return_of, mra_status, lat, lng, note, doc_json)
    VALUES (v_sale, JSON_VALUE(v_doc, '$.number'), JSON_VALUE(v_doc, '$.kind'), JSON_VALUE(v_doc, '$.status'), JSON_VALUE(v_doc, '$.pod'), JSON_VALUE(v_doc, '$.shiftId'), NVL(JSON_VALUE(v_doc, '$.device'), v_dev), NVL(JSON_VALUE(v_doc, '$.user'), v_user),
        JSON_VALUE(v_doc, '$.customer.number'), JSON_VALUE(v_doc, '$.customer.name'),
        TO_DATE(SUBSTR(JSON_VALUE(v_doc, '$.openedAt'), 1, 19), 'YYYY-MM-DD"T"HH24:MI:SS'), TO_DATE(SUBSTR(JSON_VALUE(v_doc, '$.doneAt'), 1, 19), 'YYYY-MM-DD"T"HH24:MI:SS'),
        JSON_VALUE(v_doc, '$.totals.gross' RETURNING NUMBER), JSON_VALUE(v_doc, '$.totals.disc' RETURNING NUMBER), JSON_VALUE(v_doc, '$.totals.tax' RETURNING NUMBER), JSON_VALUE(v_doc, '$.totals.cons' RETURNING NUMBER),
        JSON_VALUE(v_doc, '$.totals.crates' RETURNING NUMBER), JSON_VALUE(v_doc, '$.totals.net' RETURNING NUMBER), JSON_VALUE(v_doc, '$.totals.rounded' RETURNING NUMBER), JSON_VALUE(v_doc, '$.totals.paid' RETURNING NUMBER),
        JSON_VALUE(v_doc, '$.totals.change' RETURNING NUMBER), JSON_VALUE(v_doc, '$.totals.items' RETURNING NUMBER), JSON_VALUE(v_doc, '$.totals.units' RETURNING NUMBER), JSON_VALUE(v_doc, '$.returnOf.saleId'),
        JSON_VALUE(v_doc, '$.mra.status'), JSON_VALUE(v_doc, '$.gps.lat' RETURNING NUMBER), JSON_VALUE(v_doc, '$.gps.lng' RETURNING NUMBER), SUBSTR(JSON_VALUE(v_doc, '$.note'), 1, 1000), v_doc);
    INSERT INTO wms_pos_sale_lines (sale_id, line_no, line_id, item_code, description, uom, barcode, qty, list_price, sell_price, disc_pct, disc_cust, disc_mkt, disc_add, tax_code, tax_pct, gross, tax, cons, crates, crate_qty, net, line_type, return_of_line, note)
    SELECT v_sale, j.seq, j.line_id, j.item_code, SUBSTR(j.description, 1, 400), j.uom, j.barcode, j.qty, j.list_price, j.sell_price, j.disc_pct, j.disc_cust, j.disc_mkt, j.disc_add, j.tax_code, j.tax_pct, j.gross, j.tax, j.cons, j.crates, j.crate_qty, j.net, j.line_type, j.return_of_line, SUBSTR(j.note, 1, 400)
      FROM JSON_TABLE(v_doc, '$.lines[*]' COLUMNS (
            seq FOR ORDINALITY, line_id VARCHAR2(80) PATH '$.id', item_code VARCHAR2(80) PATH '$.item', description VARCHAR2(400) PATH '$.desc', uom VARCHAR2(20) PATH '$.uom', barcode VARCHAR2(80) PATH '$.barcode',
            qty NUMBER PATH '$.calc.qty', list_price NUMBER PATH '$.price', sell_price NUMBER PATH '$.calc.sell', disc_pct NUMBER PATH '$.calc.pct', disc_cust NUMBER PATH '$.discCust', disc_mkt NUMBER PATH '$.discMkt', disc_add NUMBER PATH '$.discAdd',
            tax_code VARCHAR2(40) PATH '$.tax', tax_pct NUMBER PATH '$.calc.taxPct', gross NUMBER PATH '$.calc.gross', tax NUMBER PATH '$.calc.tax', cons NUMBER PATH '$.calc.consTotal', crates NUMBER PATH '$.calc.crtTotal', crate_qty NUMBER PATH '$.calc.crtQty',
            net NUMBER PATH '$.calc.net', line_type VARCHAR2(10) PATH '$.type', return_of_line VARCHAR2(80) PATH '$.returnOf.lineId', note VARCHAR2(400) PATH '$.note')) j;
    INSERT INTO wms_pos_payments (sale_id, seq, tender, amount, pay_ref, paid_at)
    SELECT v_sale, j.seq, j.tender, j.amount, SUBSTR(j.pay_ref, 1, 120), TO_DATE(SUBSTR(j.at_txt, 1, 19), 'YYYY-MM-DD"T"HH24:MI:SS')
      FROM JSON_TABLE(v_doc, '$.payments[*]' COLUMNS (seq FOR ORDINALITY, tender VARCHAR2(20) PATH '$.tender', amount NUMBER PATH '$.amount', pay_ref VARCHAR2(120) PATH '$.ref', at_txt VARCHAR2(30) PATH '$.at')) j;
END;
/

CREATE OR REPLACE PROCEDURE wms_pos_unpack_shift (p_sub_id VARCHAR2) IS
    v_doc CLOB; v_user VARCHAR2(100); v_dev VARCHAR2(80); v_id VARCHAR2(80);
BEGIN
    SELECT doc_json, username, device_id INTO v_doc, v_user, v_dev FROM wms_field_submissions WHERE sub_id = p_sub_id;
    v_id := JSON_VALUE(v_doc, '$.shiftId');
    IF v_id IS NULL THEN RAISE_APPLICATION_ERROR(-20001, 'shiftId missing'); END IF;
    MERGE INTO wms_pos_shifts t USING (SELECT v_id AS shift_id FROM dual) s ON (t.shift_id = s.shift_id)
    WHEN MATCHED THEN UPDATE SET pod = JSON_VALUE(v_doc, '$.pod'), device_id = NVL(JSON_VALUE(v_doc, '$.device'), v_dev), username = NVL(JSON_VALUE(v_doc, '$.user'), v_user),
        opened_at = TO_DATE(SUBSTR(JSON_VALUE(v_doc, '$.openedAt'), 1, 19), 'YYYY-MM-DD"T"HH24:MI:SS'), float_amt = JSON_VALUE(v_doc, '$.floatAmt' RETURNING NUMBER),
        closed_at = TO_DATE(SUBSTR(JSON_VALUE(v_doc, '$.closedAt'), 1, 19), 'YYYY-MM-DD"T"HH24:MI:SS'), counted = JSON_VALUE(v_doc, '$.counted' RETURNING NUMBER), expected = JSON_VALUE(v_doc, '$.expected' RETURNING NUMBER),
        variance = JSON_VALUE(v_doc, '$.variance' RETURNING NUMBER), sales_n = JSON_VALUE(v_doc, '$.summary.sum.sales' RETURNING NUMBER), net = JSON_VALUE(v_doc, '$.summary.sum.net' RETURNING NUMBER), status = JSON_VALUE(v_doc, '$.status'), doc_json = v_doc
    WHEN NOT MATCHED THEN INSERT (shift_id, pod, device_id, username, opened_at, float_amt, closed_at, counted, expected, variance, sales_n, net, status, doc_json)
    VALUES (v_id, JSON_VALUE(v_doc, '$.pod'), NVL(JSON_VALUE(v_doc, '$.device'), v_dev), NVL(JSON_VALUE(v_doc, '$.user'), v_user),
        TO_DATE(SUBSTR(JSON_VALUE(v_doc, '$.openedAt'), 1, 19), 'YYYY-MM-DD"T"HH24:MI:SS'), JSON_VALUE(v_doc, '$.floatAmt' RETURNING NUMBER),
        TO_DATE(SUBSTR(JSON_VALUE(v_doc, '$.closedAt'), 1, 19), 'YYYY-MM-DD"T"HH24:MI:SS'), JSON_VALUE(v_doc, '$.counted' RETURNING NUMBER), JSON_VALUE(v_doc, '$.expected' RETURNING NUMBER),
        JSON_VALUE(v_doc, '$.variance' RETURNING NUMBER), JSON_VALUE(v_doc, '$.summary.sum.sales' RETURNING NUMBER), JSON_VALUE(v_doc, '$.summary.sum.net' RETURNING NUMBER), JSON_VALUE(v_doc, '$.status'), v_doc);
END;
/

-- POST field/submit?k=  {subId, app, kind, ref, amount, doc} → {ok, subId, status}
CREATE OR REPLACE PROCEDURE wms_field_submit (p_key VARCHAR2, p_body CLOB) IS
    v_dev VARCHAR2(80); v_user VARCHAR2(100);
    v_sub  VARCHAR2(80) := SUBSTR(JSON_VALUE(p_body, '$.subId'), 1, 80);
    v_app  VARCHAR2(60) := SUBSTR(JSON_VALUE(p_body, '$.app'), 1, 60);
    v_kind VARCHAR2(40) := SUBSTR(JSON_VALUE(p_body, '$.kind'), 1, 40);
    v_ref  VARCHAR2(120) := SUBSTR(JSON_VALUE(p_body, '$.ref'), 1, 120);
    v_amt  NUMBER := JSON_VALUE(p_body, '$.amount' RETURNING NUMBER);
    v_doc  CLOB := JSON_QUERY(p_body, '$.doc' RETURNING CLOB);
    v_status VARCHAR2(12) := 'NEW'; v_err VARCHAR2(2000);
    n PLS_INTEGER;
BEGIN
    IF NOT wms_field_auth(p_key, v_dev, v_user) THEN wms_field_fail(401, 'Unknown or revoked device key - pair this phone again'); RETURN; END IF;
    IF v_sub IS NULL OR v_doc IS NULL THEN wms_field_fail(400, 'subId and doc are needed'); RETURN; END IF;
    SELECT COUNT(*) INTO n FROM wms_field_submissions WHERE sub_id = v_sub;
    IF n = 0 THEN
        INSERT INTO wms_field_submissions (sub_id, app_id, kind, username, device_id, doc_ref, amount, status, doc_json)
        VALUES (v_sub, v_app, v_kind, v_user, v_dev, v_ref, v_amt, 'NEW', v_doc);
    ELSE
        UPDATE wms_field_submissions SET doc_json = v_doc, doc_ref = NVL(v_ref, doc_ref), amount = NVL(v_amt, amount), status = 'NEW', error_text = NULL WHERE sub_id = v_sub;
    END IF;
    BEGIN
        IF v_kind = 'pos_sale' THEN wms_pos_unpack_sale(v_sub); v_status := 'DONE';
        ELSIF v_kind = 'pos_shift' THEN wms_pos_unpack_shift(v_sub); v_status := 'DONE';
        END IF;
    EXCEPTION WHEN OTHERS THEN v_status := 'ERROR'; v_err := SUBSTR(SQLERRM, 1, 2000);
    END;
    UPDATE wms_field_submissions SET status = v_status, error_text = v_err, processed_date = CASE WHEN v_status = 'NEW' THEN NULL ELSE SYSDATE END WHERE sub_id = v_sub;
    COMMIT;
    owa_util.mime_header('application/json', TRUE, 'UTF-8');
    apex_json.open_object;
    apex_json.write('ok', TRUE); apex_json.write('subId', v_sub); apex_json.write('status', v_status);
    IF v_err IS NOT NULL THEN apex_json.write('error', v_err); END IF;
    apex_json.close_object;
EXCEPTION WHEN OTHERS THEN
    ROLLBACK; wms_field_fail(500, SUBSTR(SQLERRM, 1, 300));
END;
/

-- POST field/photos?k=&m=<json>  body = the picture (image/jpeg) → {ok, photoId, bytes}
CREATE OR REPLACE PROCEDURE wms_field_photo_put (p_key VARCHAR2, p_body BLOB, p_meta VARCHAR2) IS
    v_dev VARCHAR2(80); v_user VARCHAR2(100);
    v_id VARCHAR2(80); v_sha VARCHAR2(64); v_len NUMBER;
BEGIN
    IF NOT wms_field_auth(p_key, v_dev, v_user) THEN wms_field_fail(401, 'Unknown or revoked device key - pair this phone again'); RETURN; END IF;
    v_len := NVL(DBMS_LOB.getlength(p_body), 0);
    IF v_len < 100 THEN wms_field_fail(400, 'No picture in the request body'); RETURN; END IF;
    IF v_len > 8000000 THEN wms_field_fail(413, 'Picture over 8 MB'); RETURN; END IF;
    v_id := NVL(SUBSTR(JSON_VALUE(p_meta, '$.id'), 1, 80), 'ph_' || LOWER(RAWTOHEX(SYS_GUID())));
    BEGIN EXECUTE IMMEDIATE 'SELECT RAWTOHEX(DBMS_CRYPTO.HASH(:b, 4)) FROM dual' INTO v_sha USING p_body; EXCEPTION WHEN OTHERS THEN v_sha := NULL; END;
    MERGE INTO wms_field_photos t USING (SELECT v_id AS photo_id FROM dual) s ON (t.photo_id = s.photo_id)
    WHEN MATCHED THEN UPDATE SET image = p_body, bytes = v_len, sha256 = v_sha, note = SUBSTR(JSON_VALUE(p_meta, '$.note'), 1, 1000)
    WHEN NOT MATCHED THEN INSERT (photo_id, app_id, sub_id, username, device_id, taken_at, lat, lng, trip_id, bay, ref1, ref2, note, mime, bytes, sha256, width, height, image, expected_count)
    VALUES (v_id, SUBSTR(JSON_VALUE(p_meta, '$.app'), 1, 60), SUBSTR(JSON_VALUE(p_meta, '$.sub'), 1, 80), v_user, v_dev,
        NVL(TO_DATE(SUBSTR(JSON_VALUE(p_meta, '$.taken'), 1, 19), 'YYYY-MM-DD"T"HH24:MI:SS'), SYSDATE), JSON_VALUE(p_meta, '$.lat' RETURNING NUMBER), JSON_VALUE(p_meta, '$.lng' RETURNING NUMBER),
        SUBSTR(JSON_VALUE(p_meta, '$.trip'), 1, 40), SUBSTR(JSON_VALUE(p_meta, '$.bay'), 1, 60), SUBSTR(JSON_VALUE(p_meta, '$.ref1'), 1, 120), SUBSTR(JSON_VALUE(p_meta, '$.ref2'), 1, 120),
        SUBSTR(JSON_VALUE(p_meta, '$.note'), 1, 1000), NVL(SUBSTR(JSON_VALUE(p_meta, '$.mime'), 1, 60), 'image/jpeg'), v_len, v_sha,
        JSON_VALUE(p_meta, '$.width' RETURNING NUMBER), JSON_VALUE(p_meta, '$.height' RETURNING NUMBER), p_body, JSON_VALUE(p_meta, '$.expected' RETURNING NUMBER));
    COMMIT;
    owa_util.mime_header('application/json', TRUE, 'UTF-8');
    apex_json.open_object;
    apex_json.write('ok', TRUE); apex_json.write('photoId', v_id); apex_json.write('bytes', v_len); apex_json.write('sha256', v_sha);
    apex_json.close_object;
EXCEPTION WHEN OTHERS THEN
    ROLLBACK; wms_field_fail(500, SUBSTR(SQLERRM, 1, 300));
END;
/

-- GET field/photos/:id?k=
CREATE OR REPLACE PROCEDURE wms_field_photo_get (p_key VARCHAR2, p_id VARCHAR2) IS
    v_dev VARCHAR2(80); v_user VARCHAR2(100);
    v_img BLOB; v_mime VARCHAR2(60);
BEGIN
    IF NOT wms_field_auth(p_key, v_dev, v_user) THEN wms_field_fail(401, 'Unknown or revoked device key'); RETURN; END IF;
    BEGIN
        SELECT image, NVL(mime, 'image/jpeg') INTO v_img, v_mime FROM wms_field_photos WHERE photo_id = p_id;
    EXCEPTION WHEN NO_DATA_FOUND THEN wms_field_fail(404, 'No such photo'); RETURN;
    END;
    owa_util.mime_header(v_mime, FALSE);
    htp.p('Cache-Control: private, max-age=3600');
    owa_util.http_header_close;
    wpg_docload.download_file(v_img);
END;
/

-- ──────────────────────────── Part 3 · ORDS handlers ───────────────────────
DECLARE
    v_module VARCHAR2(200);
    PROCEDURE h (p_pattern VARCHAR2, p_method VARCHAR2, p_source VARCHAR2) IS
    BEGIN
        BEGIN ORDS.DEFINE_TEMPLATE(p_module_name => v_module, p_pattern => p_pattern); EXCEPTION WHEN OTHERS THEN NULL; END;
        ORDS.DEFINE_HANDLER(p_module_name => v_module, p_pattern => p_pattern, p_method => p_method, p_source_type => ORDS.source_type_plsql, p_source => p_source,
            p_comments => 'Field Apps (apex_sql/97_field_apps.sql)');
    END;
BEGIN
    SELECT name INTO v_module FROM user_ords_modules WHERE UPPER(uri_prefix) LIKE '%WAREHOUSEMANAGEMENT%' AND ROWNUM = 1;
    h('field/ping',       'GET',  'BEGIN wms_field_ping(:k); END;');
    h('field/pair',       'POST', 'BEGIN wms_field_pair(:body_text); END;');
    h('field/apps',       'GET',  'BEGIN wms_field_apps_list(:k); END;');
    h('field/apps/:id',   'GET',  'BEGIN wms_field_app_get(:k, :id); END;');
    h('field/query',      'POST', 'BEGIN wms_field_query(:k, :body_text); END;');
    h('field/submit',     'POST', 'BEGIN wms_field_submit(:k, :body_text); END;');
    h('field/photos',     'POST', 'BEGIN wms_field_photo_put(:k, :body, :m); END;');
    h('field/photos/:id', 'GET',  'BEGIN wms_field_photo_get(:k, :id); END;');
    COMMIT;
    DBMS_OUTPUT.put_line('Field Apps handlers defined on module ' || v_module);
END;
/

-- ───────────────────────── Part 4 · first settings row ─────────────────────
MERGE INTO wms_field_settings t USING (SELECT 'signing_keys' AS skey FROM dual) s ON (t.skey = s.skey)
WHEN NOT MATCHED THEN INSERT (skey, val_json, changed_by, changed_date) VALUES ('signing_keys', '[]', 'SCRIPT', SYSDATE);
COMMIT;

-- Check:  GET  .../WAREHOUSEMANAGEMENT/field/ping?k=anything   → 401 {"ok":false,"error":"Unknown or revoked device key ..."}
