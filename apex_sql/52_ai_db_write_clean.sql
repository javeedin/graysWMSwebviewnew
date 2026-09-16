-- ============================================================
-- WMS AI CHAT - DB WRITE GUARD (clean, tool-safe rewrite)
-- ============================================================
-- Replaces wms_ai_execute_write. Same behavior as 47 (literal-aware
-- single-statement write guard) but WITHOUT a nested procedure - some
-- SQL tools mis-parse the nested subprogram and fail to compile with
-- PLS-00103 at the first IF. This version uses a flat structure that
-- compiles everywhere.
--
-- Run the WHOLE thing as one statement in SQL Workshop > SQL Commands
-- (do not include the trailing slash if your tool objects to it).
-- ============================================================

CREATE OR REPLACE PROCEDURE wms_ai_execute_write (
    p_body IN CLOB
) IS
    v_sql      CLOB;
    v_clean    CLOB;
    v_scan     CLOB;
    v_app_user VARCHAR2(100);
    v_verb     VARCHAR2(30);
    v_rows     NUMBER := 0;
    v_t0       PLS_INTEGER;
    v_elapsed  PLS_INTEGER := 0;
    v_err      VARCHAR2(4000);
    v_code     VARCHAR2(30);
BEGIN
    APEX_JSON.parse(p_body);
    v_sql      := APEX_JSON.get_clob('sql');
    v_app_user := NVL(APEX_JSON.get_varchar2('appUser'), 'UNKNOWN');

    IF v_sql IS NULL OR DBMS_LOB.GETLENGTH(v_sql) = 0 THEN
        v_err  := 'Missing sql in request body';
        v_code := 'REJECTED';
    ELSE
        -- executed statement: content untouched, trimmed, one trailing ; removed
        v_clean := TRIM(BOTH CHR(10) FROM TRIM(BOTH CHR(13) FROM TRIM(v_sql)));
        v_clean := TRIM(v_clean);
        IF SUBSTR(v_clean, -1) = ';' THEN
            v_clean := TRIM(SUBSTR(v_clean, 1, LENGTH(v_clean) - 1));
        END IF;

        -- scan copy: blank string literals, then strip comments (checks only)
        v_scan := REGEXP_REPLACE(v_clean, q'{'([^']|'')*'}', q'{'X'}', 1, 0, 'n');
        v_scan := REGEXP_REPLACE(v_scan, '/\*.*?\*/', ' ', 1, 0, 'n');
        v_scan := REGEXP_REPLACE(v_scan, '--[^' || CHR(10) || ']*', ' ');

        v_verb := UPPER(REGEXP_SUBSTR(v_scan, '^\s*(\w+)', 1, 1, NULL, 1));

        IF INSTR(v_scan, ';') > 0 THEN
            v_err := 'Only a single SQL statement is allowed'; v_code := 'REJECTED';
        ELSIF v_verb NOT IN ('CREATE','ALTER','DROP','INSERT','UPDATE','DELETE','MERGE','COMMENT','TRUNCATE') THEN
            v_err := 'Statement must start with a write verb (got ' || NVL(v_verb,'nothing') || '). Use the query endpoint for SELECTs.'; v_code := 'REJECTED';
        ELSIF REGEXP_LIKE(v_scan, '(^|\W)(GRANT|REVOKE|BEGIN|DECLARE|CALL)(\W|$)', 'i')
           OR REGEXP_LIKE(v_scan, '(^|\W)(DBMS_|UTL_)', 'i')
           OR REGEXP_LIKE(v_scan, 'ALTER\s+(SESSION|SYSTEM|USER|DATABASE)', 'i') THEN
            v_err := 'Statement contains a banned element (GRANT/REVOKE, PL/SQL block, DBMS_/UTL_, or ALTER SESSION/SYSTEM/USER/DATABASE)'; v_code := 'REJECTED';
        ELSE
            v_t0 := DBMS_UTILITY.GET_TIME;
            EXECUTE IMMEDIATE v_clean;
            v_rows := SQL%ROWCOUNT;
            COMMIT;
            v_elapsed := (DBMS_UTILITY.GET_TIME - v_t0) * 10;
        END IF;
    END IF;

    IF v_err IS NOT NULL THEN
        BEGIN wms_ai_log_query(v_app_user, v_sql, NULL, v_elapsed, 'N', 'WRITE ' || v_code || ' - ' || v_err); EXCEPTION WHEN OTHERS THEN NULL; END;
        APEX_JSON.open_object;
        APEX_JSON.write('success', FALSE);
        APEX_JSON.write('error',   v_err);
        APEX_JSON.write('code',    v_code);
        APEX_JSON.close_object;
    ELSE
        BEGIN wms_ai_log_query(v_app_user, v_clean, v_rows, v_elapsed, 'Y', 'WRITE ' || v_verb); EXCEPTION WHEN OTHERS THEN NULL; END;
        APEX_JSON.open_object;
        APEX_JSON.write('success',      TRUE);
        APEX_JSON.write('verb',         v_verb);
        APEX_JSON.write('rowsAffected', v_rows);
        APEX_JSON.write('elapsedMs',    v_elapsed);
        APEX_JSON.close_object;
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        BEGIN wms_ai_log_query(v_app_user, v_sql, NULL, v_elapsed, 'N', 'WRITE ORA - ' || SQLERRM); EXCEPTION WHEN OTHERS THEN NULL; END;
        APEX_JSON.open_object;
        APEX_JSON.write('success', FALSE);
        APEX_JSON.write('error',   SQLERRM);
        APEX_JSON.write('code',    'ORA');
        APEX_JSON.close_object;
END;
/

-- Verify it compiled with no errors:
--   SELECT object_name, status FROM user_objects WHERE object_name = 'WMS_AI_EXECUTE_WRITE';
-- STATUS must be VALID. If INVALID, run:  SHOW ERRORS PROCEDURE wms_ai_execute_write
