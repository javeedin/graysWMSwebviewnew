-- ============================================================
-- WMS AI CHAT - APPROVED DATABASE WRITES (DDL / DML)
-- ============================================================
-- Lets the AI chat execute CREATE TABLE / INSERT / UPDATE /
-- DELETE etc. AFTER the user clicks Approve on the statement.
-- The approval happens in the app; this endpoint still enforces
-- its own wall: one statement, allowed verbs only, no PL/SQL
-- blocks, no GRANT/REVOKE, no ALTER SESSION/SYSTEM/USER.
-- Every execution is logged to WMS_AI_QUERY_LOG.
--
-- STEP 1: run the procedure below (SQL Workshop > SQL Commands).
-- STEP 2: create the REST handler:
--   Module:        WAREHOUSEMANAGEMENT
--   URI Template:  ai/executewrite
--   Method:        POST
--   Source Type:   PL/SQL
--   Source:        BEGIN wms_ai_execute_write(:body_text); END;
--
-- Prerequisites: 35_ai_chat_tables.sql (wms_ai_log_query)
-- ============================================================

CREATE OR REPLACE PROCEDURE wms_ai_execute_write (
    p_body IN CLOB
) IS
    v_sql      CLOB;
    v_clean    CLOB;
    v_app_user VARCHAR2(100);
    v_verb     VARCHAR2(30);
    v_rows     NUMBER := 0;
    v_t0       PLS_INTEGER;
    v_elapsed  PLS_INTEGER := 0;

    PROCEDURE respond_error (p_msg IN VARCHAR2, p_code IN VARCHAR2) IS
    BEGIN
        wms_ai_log_query(v_app_user, v_sql, NULL, v_elapsed, 'N', 'WRITE ' || p_code || ' - ' || p_msg);
        APEX_JSON.open_object;
        APEX_JSON.write('success', FALSE);
        APEX_JSON.write('error',   p_msg);
        APEX_JSON.write('code',    p_code);
        APEX_JSON.close_object;
    END respond_error;
BEGIN
    APEX_JSON.parse(p_body);
    v_sql      := APEX_JSON.get_clob('sql');
    v_app_user := NVL(APEX_JSON.get_varchar2('appUser'), 'UNKNOWN');

    IF v_sql IS NULL OR DBMS_LOB.GETLENGTH(v_sql) = 0 THEN
        respond_error('Missing sql in request body', 'REJECTED');
        RETURN;
    END IF;

    -- strip comments, trim, allow one trailing semicolon
    v_clean := REGEXP_REPLACE(v_sql,   '/\*.*?\*/', ' ', 1, 0, 'n');
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

    -- must start with an allowed write verb
    v_verb := UPPER(REGEXP_SUBSTR(v_clean, '^\s*(\w+)', 1, 1, NULL, 1));
    IF v_verb NOT IN ('CREATE','ALTER','DROP','INSERT','UPDATE','DELETE','MERGE','COMMENT','TRUNCATE') THEN
        respond_error('Statement must start with CREATE / ALTER / DROP / INSERT / UPDATE / DELETE / MERGE / COMMENT / TRUNCATE (got ' || NVL(v_verb, 'nothing') || '). Use the query endpoint for SELECTs.', 'REJECTED');
        RETURN;
    END IF;

    -- hard bans even with approval
    IF REGEXP_LIKE(v_clean, '(^|\W)(GRANT|REVOKE|BEGIN|DECLARE|CALL)(\W|$)', 'i')
       OR REGEXP_LIKE(v_clean, '(^|\W)(DBMS_|UTL_)', 'i')
       OR REGEXP_LIKE(v_clean, 'ALTER\s+(SESSION|SYSTEM|USER|DATABASE)', 'i')
    THEN
        respond_error('Statement contains a banned element (GRANT/REVOKE, PL/SQL block, DBMS_/UTL_, or ALTER SESSION/SYSTEM/USER/DATABASE)', 'REJECTED');
        RETURN;
    END IF;

    v_t0 := DBMS_UTILITY.GET_TIME;
    EXECUTE IMMEDIATE v_clean;
    v_rows := SQL%ROWCOUNT;
    COMMIT;
    v_elapsed := (DBMS_UTILITY.GET_TIME - v_t0) * 10;

    wms_ai_log_query(v_app_user, v_clean, v_rows, v_elapsed, 'Y', 'WRITE ' || v_verb);

    APEX_JSON.open_object;
    APEX_JSON.write('success',      TRUE);
    APEX_JSON.write('verb',         v_verb);
    APEX_JSON.write('rowsAffected', v_rows);
    APEX_JSON.write('elapsedMs',    v_elapsed);
    APEX_JSON.close_object;
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        IF v_t0 IS NOT NULL THEN
            v_elapsed := (DBMS_UTILITY.GET_TIME - v_t0) * 10;
        END IF;
        respond_error(SQLERRM, 'ORA');
END wms_ai_execute_write;
/

-- ============================================================
-- VERIFY
-- ============================================================
-- SELECT object_name, status FROM user_objects
-- WHERE object_name = 'WMS_AI_EXECUTE_WRITE';
--
-- Postman tests (POST .../ai/executewrite):
--   {"sql":"CREATE TABLE ai_write_test (id NUMBER)","appUser":"test"}   -> success, verb CREATE
--   {"sql":"INSERT INTO ai_write_test VALUES (1)","appUser":"test"}     -> success, rowsAffected 1
--   {"sql":"GRANT DBA TO PUBLIC","appUser":"test"}                      -> REJECTED
--   {"sql":"DROP TABLE ai_write_test","appUser":"test"}                 -> success
