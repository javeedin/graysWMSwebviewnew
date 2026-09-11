-- ============================================================
-- WMS AI CHAT - SAVED REPORTS
-- ============================================================
-- Reports created from the AI chat are stored with their SQL and
-- parameter definitions; viewing a report re-runs the SQL live,
-- prompting for parameter values.
--
-- Run order (SQL Workshop > SQL Commands, one statement at a time):
--   1. wms_ai_reports table
--   2. wms_ai_report_params table
--   3. wms_ai_execute_sql   (core executor - refactored from 35c)
--   4. wms_ai_execute_query (thin JSON wrapper - REPLACES the 35c one)
--   5. wms_ai_save_report
--   6. wms_ai_run_report
-- Then create the REST handlers listed at the bottom.
--
-- Prerequisites: 35_ai_chat_tables.sql (log tables + wms_ai_log_query)
-- ============================================================


-- ============================================================
-- 1. REPORT HEADER
-- ============================================================
CREATE TABLE wms_ai_reports (
    report_id     NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    report_name   VARCHAR2(200) NOT NULL,
    description   VARCHAR2(1000),
    category      VARCHAR2(100) DEFAULT 'General',
    sql_text      CLOB NOT NULL,
    created_by    VARCHAR2(100),
    created_date  DATE DEFAULT SYSDATE,
    updated_date  DATE,
    last_run_date DATE,
    run_count     NUMBER DEFAULT 0,
    active_flag   CHAR(1) DEFAULT 'Y' CHECK (active_flag IN ('Y','N'))
);

COMMENT ON TABLE  wms_ai_reports IS 'Reports saved from the AI Analysis chat: name + SELECT statement with optional :P_XXX bind parameters. Viewing a report re-runs the SQL live.';
COMMENT ON COLUMN wms_ai_reports.sql_text IS 'Single SELECT statement; parameters written as :P_NAME binds';


-- ============================================================
-- 2. REPORT PARAMETERS
-- ============================================================
CREATE TABLE wms_ai_report_params (
    param_id      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    report_id     NUMBER NOT NULL REFERENCES wms_ai_reports(report_id) ON DELETE CASCADE,
    param_name    VARCHAR2(60) NOT NULL,     -- bind name without colon, e.g. P_TRIP_ID
    label         VARCHAR2(200),             -- shown to the user when running
    data_type     VARCHAR2(20) DEFAULT 'TEXT' CHECK (data_type IN ('TEXT','NUMBER','DATE')),
    default_value VARCHAR2(400),
    required_flag CHAR(1) DEFAULT 'Y' CHECK (required_flag IN ('Y','N')),
    param_order   NUMBER DEFAULT 1
);

COMMENT ON TABLE wms_ai_report_params IS 'Prompt-able parameters of a saved AI report. DATE values are exchanged as YYYY-MM-DD strings.';


-- ============================================================
-- 3. CORE EXECUTOR (guardrails + DBMS_SQL fetch -> JSON via HTP)
-- ============================================================
-- Same logic as 35c, extracted so both the ad-hoc query endpoint
-- and saved-report runs share one guarded engine.
-- ============================================================
CREATE OR REPLACE PROCEDURE wms_ai_execute_sql (
    p_sql      IN CLOB,
    p_max_rows IN PLS_INTEGER,
    p_app_user IN VARCHAR2
) IS
    v_clean      CLOB;
    v_max_rows   PLS_INTEGER := LEAST(NVL(p_max_rows, 200), 1000);
    v_app_user   VARCHAR2(100) := NVL(p_app_user, 'UNKNOWN');
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

    v_json       CLOB;
    v_first_col  BOOLEAN;

    PROCEDURE emit (p_txt IN VARCHAR2) IS
    BEGIN
        IF p_txt IS NOT NULL THEN
            DBMS_LOB.WRITEAPPEND(v_json, LENGTH(p_txt), p_txt);
        END IF;
    END emit;

    PROCEDURE print_json IS
        v_len PLS_INTEGER := DBMS_LOB.GETLENGTH(v_json);
        v_pos PLS_INTEGER := 1;
    BEGIN
        WHILE v_pos <= v_len LOOP
            HTP.PRN(DBMS_LOB.SUBSTR(v_json, 8000, v_pos));
            v_pos := v_pos + 8000;
        END LOOP;
    END print_json;

    PROCEDURE respond_error (p_msg IN VARCHAR2, p_code IN VARCHAR2) IS
    BEGIN
        wms_ai_log_query(v_app_user, p_sql, NULL, v_elapsed, 'N', p_code || ' - ' || p_msg);
        APEX_JSON.open_object;
        APEX_JSON.write('success', FALSE);
        APEX_JSON.write('error',   p_msg);
        APEX_JSON.write('code',    p_code);
        APEX_JSON.close_object;
    END respond_error;

    FUNCTION num_to_json (p_n IN NUMBER) RETURN VARCHAR2 IS
        v VARCHAR2(100);
    BEGIN
        v := TO_CHAR(p_n, 'TM9', 'NLS_NUMERIC_CHARACTERS=''.,''');
        IF SUBSTR(v, 1, 1) = '.' THEN
            v := '0' || v;
        ELSIF SUBSTR(v, 1, 2) = '-.' THEN
            v := '-0' || SUBSTR(v, 2);
        END IF;
        RETURN v;
    END num_to_json;
BEGIN
    IF v_max_rows < 1 THEN v_max_rows := 200; END IF;

    IF p_sql IS NULL OR DBMS_LOB.GETLENGTH(p_sql) = 0 THEN
        respond_error('Missing SQL statement', 'REJECTED');
        RETURN;
    END IF;

    v_clean := REGEXP_REPLACE(p_sql,   '/\*.*?\*/', ' ', 1, 0, 'n');
    v_clean := REGEXP_REPLACE(v_clean, '--[^' || CHR(10) || ']*', ' ');
    v_clean := TRIM(BOTH CHR(10) FROM TRIM(BOTH CHR(13) FROM TRIM(v_clean)));
    v_clean := TRIM(v_clean);

    IF SUBSTR(v_clean, -1) = ';' THEN
        v_clean := TRIM(SUBSTR(v_clean, 1, LENGTH(v_clean) - 1));
    END IF;
    IF INSTR(v_clean, ';') > 0 THEN
        respond_error('Only a single SQL statement is allowed', 'REJECTED');
        RETURN;
    END IF;

    IF NOT REGEXP_LIKE(v_clean, '^\s*(SELECT|WITH)(\s|\()', 'i') THEN
        respond_error('Only single SELECT statements are allowed', 'REJECTED');
        RETURN;
    END IF;

    IF REGEXP_LIKE(v_clean,
        '(^|\W)(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|EXECUTE|BEGIN|DECLARE|CALL|LOCK|COMMIT|ROLLBACK)(\W|$)', 'i')
       OR REGEXP_LIKE(v_clean, 'FOR\s+UPDATE', 'i')
       OR REGEXP_LIKE(v_clean, '(^|\W)(DBMS_|UTL_)', 'i')
    THEN
        respond_error('Statement contains a banned keyword - only read-only SELECT is allowed', 'REJECTED');
        RETURN;
    END IF;

    v_wrapped := 'SELECT * FROM (' || v_clean || ') FETCH FIRST '
                 || TO_CHAR(v_max_rows + 1) || ' ROWS ONLY';

    v_t0  := DBMS_UTILITY.GET_TIME;
    v_cur := DBMS_SQL.OPEN_CURSOR;
    DBMS_SQL.PARSE(v_cur, v_wrapped, DBMS_SQL.NATIVE);
    DBMS_SQL.DESCRIBE_COLUMNS2(v_cur, v_col_cnt, v_desc);

    FOR i IN 1 .. v_col_cnt LOOP
        IF v_desc(i).col_type IN (2, 100, 101) THEN
            DBMS_SQL.DEFINE_COLUMN(v_cur, i, v_number);
        ELSIF v_desc(i).col_type = 12 THEN
            DBMS_SQL.DEFINE_COLUMN(v_cur, i, v_date);
        ELSIF v_desc(i).col_type IN (180, 181, 231) THEN
            DBMS_SQL.DEFINE_COLUMN(v_cur, i, v_ts);
        ELSE
            DBMS_SQL.DEFINE_COLUMN(v_cur, i, v_varchar, 4000);
        END IF;
    END LOOP;

    v_dummy := DBMS_SQL.EXECUTE(v_cur);

    DBMS_LOB.CREATETEMPORARY(v_json, TRUE);
    emit('{"success"' || CHR(58) || 'true,"columns"' || CHR(58) || '[');
    FOR i IN 1 .. v_col_cnt LOOP
        IF i > 1 THEN emit(','); END IF;
        emit('"' || APEX_ESCAPE.json(v_desc(i).col_name) || '"');
    END LOOP;
    emit('],"rows"' || CHR(58) || '[');

    WHILE DBMS_SQL.FETCH_ROWS(v_cur) > 0 LOOP
        IF v_rows >= v_max_rows THEN
            v_truncated := TRUE;
            EXIT;
        END IF;
        IF v_rows > 0 THEN emit(','); END IF;
        emit('[');
        v_first_col := TRUE;
        FOR i IN 1 .. v_col_cnt LOOP
            IF NOT v_first_col THEN emit(','); END IF;
            v_first_col := FALSE;
            IF v_desc(i).col_type IN (2, 100, 101) THEN
                DBMS_SQL.COLUMN_VALUE(v_cur, i, v_number);
                IF v_number IS NULL THEN emit('null');
                ELSE emit(num_to_json(v_number)); END IF;
            ELSIF v_desc(i).col_type = 12 THEN
                DBMS_SQL.COLUMN_VALUE(v_cur, i, v_date);
                IF v_date IS NULL THEN emit('null');
                ELSE emit('"' || TO_CHAR(v_date, 'YYYY-MM-DD"T"HH24:MI:SS') || '"'); END IF;
            ELSIF v_desc(i).col_type IN (180, 181, 231) THEN
                DBMS_SQL.COLUMN_VALUE(v_cur, i, v_ts);
                IF v_ts IS NULL THEN emit('null');
                ELSE emit('"' || TO_CHAR(v_ts, 'YYYY-MM-DD"T"HH24:MI:SS') || '"'); END IF;
            ELSE
                DBMS_SQL.COLUMN_VALUE(v_cur, i, v_varchar);
                IF v_varchar IS NULL THEN emit('null');
                ELSE emit('"' || APEX_ESCAPE.json(v_varchar) || '"'); END IF;
            END IF;
        END LOOP;
        emit(']');
        v_rows := v_rows + 1;
    END LOOP;

    DBMS_SQL.CLOSE_CURSOR(v_cur);
    v_elapsed := (DBMS_UTILITY.GET_TIME - v_t0) * 10;

    emit('],"rowCount"' || CHR(58) || TO_CHAR(v_rows));
    IF v_truncated THEN
        emit(',"truncated"' || CHR(58) || 'true');
    ELSE
        emit(',"truncated"' || CHR(58) || 'false');
    END IF;
    emit(',"elapsedMs"' || CHR(58) || TO_CHAR(v_elapsed) || '}');

    wms_ai_log_query(v_app_user, v_clean, v_rows, v_elapsed, 'Y', NULL);
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
        IF v_t0 IS NOT NULL THEN
            v_elapsed := (DBMS_UTILITY.GET_TIME - v_t0) * 10;
        END IF;
        respond_error(SQLERRM, 'ORA');
END wms_ai_execute_sql;
/


-- ============================================================
-- 4. THIN JSON WRAPPER (replaces the 35c version; the
--    ai/executequery handler keeps calling wms_ai_execute_query)
-- ============================================================
CREATE OR REPLACE PROCEDURE wms_ai_execute_query (
    p_body IN CLOB
) IS
    v_sql      CLOB;
    v_max_rows PLS_INTEGER;
    v_app_user VARCHAR2(100);
BEGIN
    APEX_JSON.parse(p_body);
    v_sql      := APEX_JSON.get_clob('sql');
    v_max_rows := APEX_JSON.get_number('maxRows');
    v_app_user := APEX_JSON.get_varchar2('appUser');
    wms_ai_execute_sql(v_sql, v_max_rows, v_app_user);
EXCEPTION
    WHEN OTHERS THEN
        APEX_JSON.open_object;
        APEX_JSON.write('success', FALSE);
        APEX_JSON.write('error',   SQLERRM);
        APEX_JSON.write('code',    'REJECTED');
        APEX_JSON.close_object;
END wms_ai_execute_query;
/


-- ============================================================
-- 5. SAVE (INSERT or UPDATE) A REPORT WITH ITS PARAMETERS
-- ============================================================
CREATE OR REPLACE PROCEDURE wms_ai_save_report (
    p_body IN CLOB
) IS
    v_report_id   NUMBER;
    v_name        VARCHAR2(200);
    v_desc        VARCHAR2(1000);
    v_category    VARCHAR2(100);
    v_sql         CLOB;
    v_created_by  VARCHAR2(100);
    v_param_count NUMBER;
BEGIN
    APEX_JSON.parse(p_body);
    v_report_id  := APEX_JSON.get_number('reportId');       -- null = new report
    v_name       := APEX_JSON.get_varchar2('name');
    v_desc       := APEX_JSON.get_varchar2('description');
    v_category   := NVL(APEX_JSON.get_varchar2('category'), 'General');
    v_sql        := APEX_JSON.get_clob('sql');
    v_created_by := NVL(APEX_JSON.get_varchar2('appUser'), 'UNKNOWN');

    IF v_name IS NULL OR v_sql IS NULL THEN
        APEX_JSON.open_object;
        APEX_JSON.write('success', FALSE);
        APEX_JSON.write('error', 'name and sql are required');
        APEX_JSON.close_object;
        RETURN;
    END IF;

    IF v_report_id IS NULL THEN
        INSERT INTO wms_ai_reports (report_name, description, category, sql_text, created_by)
        VALUES (v_name, v_desc, v_category, v_sql, v_created_by)
        RETURNING report_id INTO v_report_id;
    ELSE
        UPDATE wms_ai_reports
        SET report_name = v_name, description = v_desc, category = v_category,
            sql_text = v_sql, updated_date = SYSDATE
        WHERE report_id = v_report_id;
        DELETE FROM wms_ai_report_params WHERE report_id = v_report_id;
    END IF;

    v_param_count := NVL(APEX_JSON.get_count('params'), 0);
    FOR i IN 1 .. v_param_count LOOP
        INSERT INTO wms_ai_report_params
            (report_id, param_name, label, data_type, default_value, required_flag, param_order)
        VALUES (
            v_report_id,
            UPPER(REPLACE(APEX_JSON.get_varchar2('params[%d].name', i), ':', '')),
            APEX_JSON.get_varchar2('params[%d].label', i),
            NVL(UPPER(APEX_JSON.get_varchar2('params[%d].dataType', i)), 'TEXT'),
            APEX_JSON.get_varchar2('params[%d].defaultValue', i),
            CASE WHEN NVL(APEX_JSON.get_boolean('params[%d].required', i), TRUE) THEN 'Y' ELSE 'N' END,
            i
        );
    END LOOP;

    COMMIT;
    APEX_JSON.open_object;
    APEX_JSON.write('success', TRUE);
    APEX_JSON.write('reportId', v_report_id);
    APEX_JSON.write('paramCount', v_param_count);
    APEX_JSON.close_object;
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        APEX_JSON.open_object;
        APEX_JSON.write('success', FALSE);
        APEX_JSON.write('error', SQLERRM);
        APEX_JSON.close_object;
END wms_ai_save_report;
/


-- ============================================================
-- 6. RUN A SAVED REPORT WITH PARAMETER VALUES
-- ============================================================
-- Body: { "reportId": 1, "maxRows": 200, "appUser": "javeed",
--         "params": { "P_TRIP_ID": "6720", "P_START_DATE": "2026-09-01" } }
-- Parameter values are validated by declared type and substituted
-- as safe literals; the result then passes through the same
-- guarded executor (SELECT-only, keyword ban, row cap).
-- ============================================================
CREATE OR REPLACE PROCEDURE wms_ai_run_report (
    p_body IN CLOB
) IS
    v_report_id NUMBER;
    v_max_rows  PLS_INTEGER;
    v_app_user  VARCHAR2(100);
    v_sql       CLOB;
    v_value     VARCHAR2(400);
    v_literal   VARCHAR2(500);
    v_num       NUMBER;
    v_missing   VARCHAR2(400) := NULL;
BEGIN
    APEX_JSON.parse(p_body);
    v_report_id := APEX_JSON.get_number('reportId');
    v_max_rows  := APEX_JSON.get_number('maxRows');
    v_app_user  := NVL(APEX_JSON.get_varchar2('appUser'), 'UNKNOWN');

    BEGIN
        SELECT sql_text INTO v_sql
        FROM wms_ai_reports
        WHERE report_id = v_report_id AND active_flag = 'Y';
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            APEX_JSON.open_object;
            APEX_JSON.write('success', FALSE);
            APEX_JSON.write('error', 'Report ' || v_report_id || ' not found');
            APEX_JSON.close_object;
            RETURN;
    END;

    FOR prm IN (SELECT param_name, data_type, default_value, required_flag
                FROM wms_ai_report_params
                WHERE report_id = v_report_id
                ORDER BY param_order) LOOP

        v_value := APEX_JSON.get_varchar2('params.' || prm.param_name);
        IF v_value IS NULL THEN
            v_value := prm.default_value;
        END IF;

        IF v_value IS NULL THEN
            IF prm.required_flag = 'Y' THEN
                v_missing := prm.param_name;
                EXIT;
            END IF;
            v_literal := 'NULL';
        ELSIF prm.data_type = 'NUMBER' THEN
            BEGIN
                v_num := TO_NUMBER(v_value);
                v_literal := TO_CHAR(v_num, 'TM9', 'NLS_NUMERIC_CHARACTERS=''.,''');
            EXCEPTION WHEN OTHERS THEN
                v_missing := prm.param_name || ' (not a valid number: ' || v_value || ')';
                EXIT;
            END;
        ELSIF prm.data_type = 'DATE' THEN
            v_literal := 'TO_DATE(''' || REPLACE(SUBSTR(v_value, 1, 10), '''', '') || ''',''YYYY-MM-DD'')';
        ELSE
            v_literal := '''' || REPLACE(v_value, '''', '''''') || '''';
        END IF;

        -- replace :NAME (word boundary, case-insensitive)
        v_sql := REGEXP_REPLACE(v_sql, ':' || prm.param_name || '(\W|$)', v_literal || '\1', 1, 0, 'i');
    END LOOP;

    IF v_missing IS NOT NULL THEN
        APEX_JSON.open_object;
        APEX_JSON.write('success', FALSE);
        APEX_JSON.write('error', 'Missing/invalid required parameter: ' || v_missing);
        APEX_JSON.write('code', 'PARAM');
        APEX_JSON.close_object;
        RETURN;
    END IF;

    UPDATE wms_ai_reports
    SET last_run_date = SYSDATE, run_count = NVL(run_count, 0) + 1
    WHERE report_id = v_report_id;
    COMMIT;

    wms_ai_execute_sql(v_sql, v_max_rows, v_app_user);
EXCEPTION
    WHEN OTHERS THEN
        APEX_JSON.open_object;
        APEX_JSON.write('success', FALSE);
        APEX_JSON.write('error', SQLERRM);
        APEX_JSON.close_object;
END wms_ai_run_report;
/


-- ============================================================
-- REST HANDLERS (create in APEX > RESTful Services,
-- module WAREHOUSEMANAGEMENT, Source Type PL/SQL)
-- ============================================================
--
-- POST  ai/reports/save     ->  BEGIN wms_ai_save_report(:body_text); END;
-- POST  ai/reports/run      ->  BEGIN wms_ai_run_report(:body_text); END;
-- POST  ai/reports/delete   ->  (block A below)
-- GET   ai/reports/list     ->  (block B below)
-- GET   ai/reports/get      ->  (block C below; add handler parameter:
--                                Name=id, Bind Variable=id, Source=URI, IN, STRING)
--
-- ── block A: POST ai/reports/delete  {"reportId": 1} ─────────
-- DECLARE
--     v_id NUMBER;
-- BEGIN
--     APEX_JSON.parse(:body_text);
--     v_id := APEX_JSON.get_number('reportId');
--     DELETE FROM wms_ai_report_params WHERE report_id = v_id;
--     DELETE FROM wms_ai_reports WHERE report_id = v_id;
--     COMMIT;
--     APEX_JSON.open_object;
--     APEX_JSON.write('success', TRUE);
--     APEX_JSON.close_object;
-- EXCEPTION WHEN OTHERS THEN
--     ROLLBACK;
--     APEX_JSON.open_object;
--     APEX_JSON.write('success', FALSE);
--     APEX_JSON.write('error', SQLERRM);
--     APEX_JSON.close_object;
-- END;
--
-- ── block B: GET ai/reports/list ─────────────────────────────
-- BEGIN
--     APEX_JSON.open_object;
--     APEX_JSON.open_array('reports');
--     FOR r IN (SELECT r.report_id, r.report_name, r.description, r.category,
--                      r.created_by, r.created_date, r.last_run_date, r.run_count,
--                      (SELECT COUNT(*) FROM wms_ai_report_params p
--                       WHERE p.report_id = r.report_id) AS param_count
--               FROM wms_ai_reports r
--               WHERE r.active_flag = 'Y'
--               ORDER BY r.category, r.report_name) LOOP
--         APEX_JSON.open_object;
--         APEX_JSON.write('reportId',    r.report_id);
--         APEX_JSON.write('name',        r.report_name);
--         APEX_JSON.write('description', r.description);
--         APEX_JSON.write('category',    r.category);
--         APEX_JSON.write('createdBy',   r.created_by);
--         APEX_JSON.write('createdDate', TO_CHAR(r.created_date, 'YYYY-MM-DD'));
--         APEX_JSON.write('lastRunDate', TO_CHAR(r.last_run_date, 'YYYY-MM-DD HH24:MI'));
--         APEX_JSON.write('runCount',    NVL(r.run_count, 0));
--         APEX_JSON.write('paramCount',  r.param_count);
--         APEX_JSON.close_object;
--     END LOOP;
--     APEX_JSON.close_array;
--     APEX_JSON.close_object;
-- END;
--
-- ── block C: GET ai/reports/get?id=1 ─────────────────────────
-- DECLARE
--     v_id NUMBER := TO_NUMBER(:id);
-- BEGIN
--     FOR r IN (SELECT * FROM wms_ai_reports WHERE report_id = v_id) LOOP
--         APEX_JSON.open_object;
--         APEX_JSON.write('reportId',    r.report_id);
--         APEX_JSON.write('name',        r.report_name);
--         APEX_JSON.write('description', r.description);
--         APEX_JSON.write('category',    r.category);
--         APEX_JSON.write('sql',         r.sql_text);
--         APEX_JSON.open_array('params');
--         FOR p IN (SELECT * FROM wms_ai_report_params
--                   WHERE report_id = v_id ORDER BY param_order) LOOP
--             APEX_JSON.open_object;
--             APEX_JSON.write('name',         p.param_name);
--             APEX_JSON.write('label',        NVL(p.label, p.param_name));
--             APEX_JSON.write('dataType',     p.data_type);
--             APEX_JSON.write('defaultValue', p.default_value);
--             APEX_JSON.write('required',     p.required_flag = 'Y');
--             APEX_JSON.close_object;
--         END LOOP;
--         APEX_JSON.close_array;
--         APEX_JSON.close_object;
--         RETURN;
--     END LOOP;
--     APEX_JSON.open_object;
--     APEX_JSON.write('success', FALSE);
--     APEX_JSON.write('error', 'Report not found');
--     APEX_JSON.close_object;
-- END;
