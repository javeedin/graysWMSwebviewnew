-- ============================================================
-- WMS AI CHAT - DB WRITE GUARD FIX (string-literal aware)
-- ============================================================
-- Replaces wms_ai_execute_write (from 37_ai_db_write.sql).
--
-- Why: the original guard scanned the RAW statement, so text
-- INSIDE quoted string literals tripped it - e.g. teaching the
-- order.creation process a validation containing "SELECT ... ;"
-- was rejected as "multiple statements", which pushed the model
-- into ugly workarounds (split keywords, CHR(59)). Worse, the
-- comment stripper edited the executed SQL itself, so a "--" or
-- "/*" inside a string literal corrupted the written data.
--
-- Fix: the ORIGINAL statement is executed untouched (only
-- trimmed, one trailing semicolon removed). All safety checks
-- run on a SCAN COPY in which string literals are blanked out
-- first and comments removed second. Literal content can no
-- longer trip the guard, and real smuggled statements/keywords
-- outside literals are still caught.
--
-- Run in SQL Workshop > SQL Commands (CREATE OR REPLACE).
-- ============================================================

CREATE OR REPLACE PROCEDURE wms_ai_execute_write (
    p_body IN CLOB
) IS
    v_sql      CLOB;
    v_clean    CLOB;          -- what gets executed (unmodified content)
    v_scan     CLOB;          -- literal-blanked copy used for all checks
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

    -- The executed statement: content untouched, just trimmed with at
    -- most one trailing semicolon removed
    v_clean := TRIM(BOTH CHR(10) FROM TRIM(BOTH CHR(13) FROM TRIM(v_sql)));
    v_clean := TRIM(v_clean);
    IF SUBSTR(v_clean, -1) = ';' THEN
        v_clean := TRIM(SUBSTR(v_clean, 1, LENGTH(v_clean) - 1));
    END IF;

    -- Scan copy: 1) blank out string literals ('' escapes included),
    -- 2) then strip comments. Checks below never see literal content.
    v_scan := REGEXP_REPLACE(v_clean, q'{'([^']|'')*'}', q'{'X'}', 1, 0, 'n');
    v_scan := REGEXP_REPLACE(v_scan, '/\*.*?\*/', ' ', 1, 0, 'n');
    v_scan := REGEXP_REPLACE(v_scan, '--[^' || CHR(10) || ']*', ' ');

    -- one statement only (semicolons inside literals no longer count)
    IF INSTR(v_scan, ';') > 0 THEN
        respond_error('Only a single SQL statement is allowed', 'REJECTED');
        RETURN;
    END IF;

    -- must start with an allowed write verb
    v_verb := UPPER(REGEXP_SUBSTR(v_scan, '^\s*(\w+)', 1, 1, NULL, 1));
    IF v_verb NOT IN ('CREATE','ALTER','DROP','INSERT','UPDATE','DELETE','MERGE','COMMENT','TRUNCATE') THEN
        respond_error('Statement must start with CREATE / ALTER / DROP / INSERT / UPDATE / DELETE / MERGE / COMMENT / TRUNCATE (got ' || NVL(v_verb, 'nothing') || '). Use the query endpoint for SELECTs.', 'REJECTED');
        RETURN;
    END IF;

    -- hard bans even with approval (checked outside literals only)
    IF REGEXP_LIKE(v_scan, '(^|\W)(GRANT|REVOKE|BEGIN|DECLARE|CALL)(\W|$)', 'i')
       OR REGEXP_LIKE(v_scan, '(^|\W)(DBMS_|UTL_)', 'i')
       OR REGEXP_LIKE(v_scan, 'ALTER\s+(SESSION|SYSTEM|USER|DATABASE)', 'i')
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
-- VERIFY - all three must now behave correctly:
-- 1) legit literal content passes:
--    {"sql":"UPDATE wms_ai_processes SET validations = 'CHECK_SQL: SELECT 1 FROM dual; -- ok' WHERE 1=0","appUser":"test"}  -> success, 0 rows
-- 2) real second statement still rejected:
--    {"sql":"DELETE FROM ai_x WHERE 1=0; DROP TABLE ai_x","appUser":"test"}  -> REJECTED
-- 3) banned keyword outside literals still rejected:
--    {"sql":"CREATE TABLE t AS SELECT * FROM session_privs WHERE UTL_HTTP.request('x') IS NOT NULL","appUser":"test"}  -> REJECTED
-- ============================================================
