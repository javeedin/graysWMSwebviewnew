-- ============================================================
-- WMS AI CHAT - APEX REST HANDLERS (Phase P1)
-- ============================================================
-- Module:        AIMODULE   (NEW module - create it first, see below)
-- Run these in APEX SQL Workshop > RESTful Services
-- OR paste each block into the Handler Source in APEX UI
-- ============================================================
-- Prerequisite:  35_ai_chat_tables.sql must be executed first
-- ============================================================
--
-- MODULE SETUP (once, in APEX > SQL Workshop > RESTful Services):
--   Module Name:      AIMODULE
--   Base Path:        /AIMODULE/
--   Status:           Published
--   Templates:
--     1) URI Template: metadata     (handler: GET,  Source Type: PL/SQL)
--     2) URI Template: query        (handler: POST, Source Type: PL/SQL)
--
-- Resulting URLs:
--   GET  .../ords/WKSP_GRAYSAPP/AIMODULE/metadata
--   GET  .../ords/WKSP_GRAYSAPP/AIMODULE/metadata?object=WMS_TRIP_CONFIG
--   POST .../ords/WKSP_GRAYSAPP/AIMODULE/query
--
-- NOTE on the GET parameter: ORDS auto-binds query-string
-- parameters. If :object raises "bind not declared" in your APEX
-- version, add a handler Parameter: Name=object, Bind Variable=object,
-- Source Type=URI, Access Method=IN.
--
-- POSTMAN TESTS (P1 acceptance):
--   1) GET  metadata               -> full schema JSON, < 2 s
--   2) GET  metadata?object=X      -> single object
--   3) POST query {"sql":"SELECT trip_id, trip_lorry FROM wms_trip_config"}
--                                  -> success:true with rows
--   4) POST query {"sql":"UPDATE wms_trip_config SET trip_priority=1"}
--                                  -> success:false, code REJECTED
--   5) POST query {"sql":"SELECT * FROM wms_print_jobs", "maxRows": 5}
--                                  -> 5 rows, truncated:true (if > 5 exist)
--   6) SELECT * FROM wms_ai_query_log ORDER BY log_id DESC  -> calls logged
-- ============================================================


-- ============================================================
-- HANDLER 1: GET  metadata
-- ============================================================
-- Module:        AIMODULE
-- URI Template:  metadata
-- Method:        GET
-- Source Type:   PL/SQL
-- ============================================================
-- Returns every table/view (with columns + comments) the AI may
-- query. Governance via WMS_AI_OBJECT_ACL (R-4.1.2):
--   * rows with allowed_flag='N'  -> always hidden
--   * >=1 row with allowed_flag='Y' -> whitelist mode (only Y shown)
--   * no rows at all              -> everything visible
-- Optional ?object=NAME returns just that object (R-4.1.1).
-- ============================================================
DECLARE
    v_object     VARCHAR2(128) := UPPER(TRIM(:object));
    v_whitelist  NUMBER;  -- count of 'Y' rows: > 0 means whitelist mode
BEGIN
    SELECT COUNT(*) INTO v_whitelist
    FROM wms_ai_object_acl WHERE allowed_flag = 'Y';

    APEX_JSON.open_object;
    APEX_JSON.write('generatedAt',
        TO_CHAR(SYSTIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
    APEX_JSON.open_array('objects');

    FOR obj IN (
        SELECT o.object_name, o.object_type, tc.comments
        FROM   user_objects o
        LEFT   JOIN user_tab_comments tc ON tc.table_name = o.object_name
        WHERE  o.object_type IN ('TABLE','VIEW')
        AND    o.object_name NOT LIKE 'APEX$%'
        AND    o.object_name NOT LIKE 'DR$%'
        AND    o.object_name NOT LIKE 'ISEQ$%'
        AND    o.object_name NOT LIKE 'SYS_%'
        AND   (v_object IS NULL OR o.object_name = v_object)
        AND    NOT EXISTS (SELECT 1 FROM wms_ai_object_acl d
                           WHERE d.object_name = o.object_name
                           AND   d.allowed_flag = 'N')
        AND   (v_whitelist = 0 OR EXISTS (
                           SELECT 1 FROM wms_ai_object_acl a
                           WHERE a.object_name = o.object_name
                           AND   a.allowed_flag = 'Y'))
        ORDER BY o.object_name
    ) LOOP
        APEX_JSON.open_object;
        APEX_JSON.write('name',    obj.object_name);
        APEX_JSON.write('type',    obj.object_type);
        APEX_JSON.write('comment', obj.comments, p_write_null => TRUE);
        APEX_JSON.open_array('columns');

        FOR col IN (
            SELECT c.column_name,
                   CASE
                     WHEN c.data_type IN ('VARCHAR2','NVARCHAR2','CHAR','NCHAR','RAW')
                          THEN c.data_type || '(' || c.data_length || ')'
                     WHEN c.data_type = 'NUMBER' AND c.data_precision IS NOT NULL
                          THEN 'NUMBER(' || c.data_precision ||
                               CASE WHEN NVL(c.data_scale,0) > 0
                                    THEN ',' || c.data_scale END || ')'
                     ELSE c.data_type
                   END AS data_type,
                   c.nullable,
                   cc.comments
            FROM   user_tab_columns c
            LEFT   JOIN user_col_comments cc
                   ON  cc.table_name  = c.table_name
                   AND cc.column_name = c.column_name
            WHERE  c.table_name = obj.object_name
            ORDER BY c.column_id
        ) LOOP
            APEX_JSON.open_object;
            APEX_JSON.write('name',     col.column_name);
            APEX_JSON.write('dataType', col.data_type);
            APEX_JSON.write('nullable', col.nullable);
            APEX_JSON.write('comment',  col.comments, p_write_null => TRUE);
            APEX_JSON.close_object;
        END LOOP;

        APEX_JSON.close_array;
        APEX_JSON.close_object;
    END LOOP;

    APEX_JSON.close_array;
    APEX_JSON.close_object;
EXCEPTION
    WHEN OTHERS THEN
        APEX_JSON.open_object;
        APEX_JSON.write('success', FALSE);
        APEX_JSON.write('error',   SQLERRM);
        APEX_JSON.close_object;
END;


-- ============================================================
-- HANDLER 2: POST  query
-- ============================================================
-- Module:        AIMODULE
-- URI Template:  query
-- Method:        POST
-- Source Type:   PL/SQL
-- ============================================================
-- Body:  { "sql": "SELECT ...", "maxRows": 200, "appUser": "javeed" }
-- OK:    { "success":true, "columns":[...], "rows":[[...]],
--          "rowCount":n, "truncated":bool, "elapsedMs":n }
-- Fail:  { "success":false, "error":"...", "code":"REJECTED"|"ORA" }
--
-- Guardrails (R-4.2.1 .. R-4.2.8) enforced HERE, never trusted
-- to the model:
--   1. exactly one statement (no ';' after trimming one trailing)
--   2. must start with SELECT or WITH (comments stripped first)
--   3. keyword ban, word-boundary, case-insensitive
--   4. row cap: default 200, hard cap 1000, +1 fetched to detect
--      truncation, wrapped as SELECT * FROM (sql) FETCH FIRST n
--   5. DBMS_SQL describe/fetch; DATE/TIMESTAMP as ISO strings,
--      NUMBER as JSON numbers
--   6. timeout: relies on the ORDS pool statement timeout
--      (document/verify in ORDS defaults.xml: jdbc.statementTimeout)
--   7. runs in the APEX schema (accepted decision - no proxy user)
--   8. every call logged to WMS_AI_QUERY_LOG via WMS_AI_LOG_QUERY
-- ============================================================
DECLARE
    v_body       CLOB := :body_text;
    v_sql        CLOB;
    v_clean      CLOB;
    v_max_rows   PLS_INTEGER;
    v_app_user   VARCHAR2(100);
    v_wrapped    CLOB;

    v_cur        INTEGER;
    v_col_cnt    INTEGER;
    v_desc       DBMS_SQL.DESC_TAB2;
    v_varchar    VARCHAR2(4000);
    v_number     NUMBER;
    v_date       DATE;
    v_ts         TIMESTAMP;
    v_dummy      INTEGER;

    v_rows       PLS_INTEGER := 0;
    v_truncated  BOOLEAN := FALSE;
    v_t0         PLS_INTEGER;
    v_elapsed    PLS_INTEGER := 0;

    v_json       CLOB;          -- response built here, printed at the end
    v_num_str    VARCHAR2(100);
    v_first_col  BOOLEAN;

    -- ---- helpers ------------------------------------------------
    PROCEDURE emit(p_txt IN VARCHAR2) IS
    BEGIN
        DBMS_LOB.WRITEAPPEND(v_json, LENGTH(p_txt), p_txt);
    END;

    PROCEDURE print_json IS
        v_len PLS_INTEGER := DBMS_LOB.GETLENGTH(v_json);
        v_pos PLS_INTEGER := 1;
    BEGIN
        WHILE v_pos <= v_len LOOP
            HTP.PRN(DBMS_LOB.SUBSTR(v_json, 8000, v_pos));
            v_pos := v_pos + 8000;
        END LOOP;
    END;

    PROCEDURE respond_error(p_msg IN VARCHAR2, p_code IN VARCHAR2) IS
    BEGIN
        wms_ai_log_query(v_app_user, v_sql, NULL, v_elapsed, 'N', p_code || ': ' || p_msg);
        APEX_JSON.open_object;
        APEX_JSON.write('success', FALSE);
        APEX_JSON.write('error',   p_msg);
        APEX_JSON.write('code',    p_code);
        APEX_JSON.close_object;
    END;

    -- JSON-safe number: TM format can yield ".5" / "-.5"
    FUNCTION num_to_json(p_n IN NUMBER) RETURN VARCHAR2 IS
        v VARCHAR2(100);
    BEGIN
        v := TO_CHAR(p_n, 'TM9', 'NLS_NUMERIC_CHARACTERS=''.,''');
        IF v LIKE '.%'  THEN v := '0'  || v; END IF;
        IF v LIKE '-.%' THEN v := '-0' || SUBSTR(v, 2); END IF;
        RETURN v;
    END;
BEGIN
    -- ---- parse request -------------------------------------------
    APEX_JSON.parse(v_body);
    v_sql      := APEX_JSON.get_clob('sql');
    v_max_rows := LEAST(NVL(APEX_JSON.get_number('maxRows'), 200), 1000);  -- R-4.2.4
    IF v_max_rows < 1 THEN v_max_rows := 200; END IF;
    v_app_user := NVL(APEX_JSON.get_varchar2('appUser'), 'UNKNOWN');

    IF v_sql IS NULL OR DBMS_LOB.GETLENGTH(v_sql) = 0 THEN
        respond_error('Missing "sql" in request body', 'REJECTED');
        RETURN;
    END IF;

    -- ---- guardrails ----------------------------------------------
    -- strip block comments, then line comments, then trim (R-4.2.2 prep)
    v_clean := REGEXP_REPLACE(v_sql,   '/\*.*?\*/', ' ', 1, 0, 'n');
    v_clean := REGEXP_REPLACE(v_clean, '--[^' || CHR(10) || ']*', ' ');
    v_clean := TRIM(BOTH CHR(10) FROM TRIM(BOTH CHR(13) FROM TRIM(v_clean)));
    v_clean := TRIM(v_clean);

    -- allow exactly one trailing ';' (R-4.2.1)
    IF SUBSTR(v_clean, -1) = ';' THEN
        v_clean := TRIM(SUBSTR(v_clean, 1, LENGTH(v_clean) - 1));
    END IF;
    IF INSTR(v_clean, ';') > 0 THEN
        respond_error('Only a single SQL statement is allowed', 'REJECTED');
        RETURN;
    END IF;

    -- must start with SELECT or WITH (R-4.2.2)
    IF NOT REGEXP_LIKE(v_clean, '^\s*(SELECT|WITH)(\s|\()', 'i') THEN
        respond_error('Only single SELECT statements are allowed', 'REJECTED');
        RETURN;
    END IF;

    -- keyword ban (R-4.2.3)
    IF REGEXP_LIKE(v_clean,
        '(^|\W)(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|EXECUTE|BEGIN|DECLARE|CALL|LOCK|COMMIT|ROLLBACK)(\W|$)', 'i')
       OR REGEXP_LIKE(v_clean, 'FOR\s+UPDATE', 'i')
       OR REGEXP_LIKE(v_clean, '(^|\W)(DBMS_|UTL_)', 'i')
    THEN
        respond_error('Statement contains a banned keyword - only read-only SELECT is allowed', 'REJECTED');
        RETURN;
    END IF;

    -- ---- execute (R-4.2.4 / R-4.2.5) ------------------------------
    -- fetch maxRows+1 to detect truncation
    v_wrapped := 'SELECT * FROM (' || v_clean || ') FETCH FIRST '
                 || TO_CHAR(v_max_rows + 1) || ' ROWS ONLY';

    v_t0  := DBMS_UTILITY.GET_TIME;
    v_cur := DBMS_SQL.OPEN_CURSOR;
    DBMS_SQL.PARSE(v_cur, v_wrapped, DBMS_SQL.NATIVE);
    DBMS_SQL.DESCRIBE_COLUMNS2(v_cur, v_col_cnt, v_desc);

    FOR i IN 1 .. v_col_cnt LOOP
        CASE
            WHEN v_desc(i).col_type IN (2, 100, 101) THEN               -- NUMBER / FLOAT
                DBMS_SQL.DEFINE_COLUMN(v_cur, i, v_number);
            WHEN v_desc(i).col_type = 12 THEN                           -- DATE
                DBMS_SQL.DEFINE_COLUMN(v_cur, i, v_date);
            WHEN v_desc(i).col_type IN (180, 181, 231) THEN             -- TIMESTAMP variants
                DBMS_SQL.DEFINE_COLUMN(v_cur, i, v_ts);
            ELSE                                                        -- everything else as text
                DBMS_SQL.DEFINE_COLUMN(v_cur, i, v_varchar, 4000);
        END CASE;
    END LOOP;

    v_dummy := DBMS_SQL.EXECUTE(v_cur);

    -- build the response in a CLOB so an ORA error mid-fetch
    -- cannot corrupt already-sent output
    DBMS_LOB.CREATETEMPORARY(v_json, TRUE);
    emit('{"success":true,"columns":[');
    FOR i IN 1 .. v_col_cnt LOOP
        IF i > 1 THEN emit(','); END IF;
        emit('"' || APEX_ESCAPE.json(v_desc(i).col_name) || '"');
    END LOOP;
    emit('],"rows":[');

    WHILE DBMS_SQL.FETCH_ROWS(v_cur) > 0 LOOP
        IF v_rows >= v_max_rows THEN
            v_truncated := TRUE;    -- the +1 row exists; don't emit it
            EXIT;
        END IF;
        IF v_rows > 0 THEN emit(','); END IF;
        emit('[');
        v_first_col := TRUE;
        FOR i IN 1 .. v_col_cnt LOOP
            IF NOT v_first_col THEN emit(','); END IF;
            v_first_col := FALSE;
            CASE
                WHEN v_desc(i).col_type IN (2, 100, 101) THEN
                    DBMS_SQL.COLUMN_VALUE(v_cur, i, v_number);
                    IF v_number IS NULL THEN emit('null');
                    ELSE emit(num_to_json(v_number)); END IF;
                WHEN v_desc(i).col_type = 12 THEN
                    DBMS_SQL.COLUMN_VALUE(v_cur, i, v_date);
                    IF v_date IS NULL THEN emit('null');
                    ELSE emit('"' || TO_CHAR(v_date, 'YYYY-MM-DD"T"HH24:MI:SS') || '"'); END IF;
                WHEN v_desc(i).col_type IN (180, 181, 231) THEN
                    DBMS_SQL.COLUMN_VALUE(v_cur, i, v_ts);
                    IF v_ts IS NULL THEN emit('null');
                    ELSE emit('"' || TO_CHAR(v_ts, 'YYYY-MM-DD"T"HH24:MI:SS') || '"'); END IF;
                ELSE
                    DBMS_SQL.COLUMN_VALUE(v_cur, i, v_varchar);
                    IF v_varchar IS NULL THEN emit('null');
                    ELSE emit('"' || APEX_ESCAPE.json(v_varchar) || '"'); END IF;
            END CASE;
        END LOOP;
        emit(']');
        v_rows := v_rows + 1;
    END LOOP;

    DBMS_SQL.CLOSE_CURSOR(v_cur);
    v_elapsed := (DBMS_UTILITY.GET_TIME - v_t0) * 10;   -- centiseconds -> ms

    emit('],"rowCount":' || v_rows
         || ',"truncated":' || CASE WHEN v_truncated THEN 'true' ELSE 'false' END
         || ',"elapsedMs":' || v_elapsed || '}');

    wms_ai_log_query(v_app_user, v_clean, v_rows, v_elapsed, 'Y', NULL);   -- R-4.2.8
    print_json;
    DBMS_LOB.FREETEMPORARY(v_json);

EXCEPTION
    WHEN OTHERS THEN
        IF v_cur IS NOT NULL AND DBMS_SQL.IS_OPEN(v_cur) THEN
            DBMS_SQL.CLOSE_CURSOR(v_cur);
        END IF;
        IF v_json IS NOT NULL THEN
            DBMS_LOB.FREETEMPORARY(v_json);
        END IF;
        v_elapsed := CASE WHEN v_t0 IS NULL THEN 0
                          ELSE (DBMS_UTILITY.GET_TIME - v_t0) * 10 END;
        -- ORA message passes through so the model can self-correct
        respond_error(SQLERRM, 'ORA');
END;
