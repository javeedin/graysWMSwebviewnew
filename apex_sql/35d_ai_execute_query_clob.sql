-- ============================================================
-- WMS AI CHAT - EXECUTE QUERY (CLOB-safe)  — replaces 35c
-- ============================================================
-- Fix: the previous version fetched every text column as
-- VARCHAR2(4000), so any CLOB column (e.g. WMS_AI_FORMS.DEFINITION,
-- which holds an entire form as JSON and is often > 4000 chars) came
-- back TRUNCATED or NULL. Loading a large form then failed with
-- "Cannot read properties of null (reading 'header')".
--
-- This version detects CLOB columns (type 112) and fetches/emits them
-- in full, chunked and JSON-escaped, so large definitions load intact.
--
-- Run in SQL Workshop > SQL Commands (CREATE OR REPLACE). The
-- ai/executequery handler stays:   BEGIN wms_ai_execute_query(:body_text); END;
-- ============================================================

CREATE OR REPLACE PROCEDURE wms_ai_execute_query (
    p_body IN CLOB
) IS
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
    v_clob       CLOB;
    v_clen       PLS_INTEGER;
    v_cpos       PLS_INTEGER;
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
        wms_ai_log_query(v_app_user, v_sql, NULL, v_elapsed, 'N',
                         p_code || ' - ' || p_msg);
        APEX_JSON.open_object;
        APEX_JSON.write('success', FALSE);
        APEX_JSON.write('error',   p_msg);
        APEX_JSON.write('code',    p_code);
        APEX_JSON.close_object;
    END respond_error;

    -- JSON-safe number: TM format can yield '.5' / '-.5'
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

    -- emit a CLOB as a JSON string value, chunked so APEX_ESCAPE.json
    -- (VARCHAR2, max 32767) never overflows on a large value
    PROCEDURE emit_clob (p_c IN CLOB) IS
        v_len PLS_INTEGER;
        v_pos PLS_INTEGER := 1;
    BEGIN
        IF p_c IS NULL THEN emit('null'); RETURN; END IF;
        v_len := DBMS_LOB.GETLENGTH(p_c);
        emit('"');
        WHILE v_pos <= v_len LOOP
            emit(APEX_ESCAPE.json(DBMS_LOB.SUBSTR(p_c, 4000, v_pos)));
            v_pos := v_pos + 4000;
        END LOOP;
        emit('"');
    END emit_clob;
BEGIN
    APEX_JSON.parse(p_body);
    v_sql      := APEX_JSON.get_clob('sql');
    v_max_rows := LEAST(NVL(APEX_JSON.get_number('maxRows'), 200), 1000);
    IF v_max_rows IS NULL OR v_max_rows < 1 THEN
        v_max_rows := 200;
    END IF;
    v_app_user := NVL(APEX_JSON.get_varchar2('appUser'), 'UNKNOWN');

    IF v_sql IS NULL OR DBMS_LOB.GETLENGTH(v_sql) = 0 THEN
        respond_error('Missing sql in request body', 'REJECTED');
        RETURN;
    END IF;

    -- strip block comments, then line comments, then trim
    v_clean := REGEXP_REPLACE(v_sql,   '/\*.*?\*/', ' ', 1, 0, 'n');
    v_clean := REGEXP_REPLACE(v_clean, '--[^' || CHR(10) || ']*', ' ');
    v_clean := TRIM(BOTH CHR(10) FROM TRIM(BOTH CHR(13) FROM TRIM(v_clean)));
    v_clean := TRIM(v_clean);

    -- allow exactly one trailing semicolon
    IF SUBSTR(v_clean, -1) = ';' THEN
        v_clean := TRIM(SUBSTR(v_clean, 1, LENGTH(v_clean) - 1));
    END IF;
    IF INSTR(v_clean, ';') > 0 THEN
        respond_error('Only a single SQL statement is allowed', 'REJECTED');
        RETURN;
    END IF;

    -- must start with SELECT or WITH
    IF NOT REGEXP_LIKE(v_clean, '^\s*(SELECT|WITH)(\s|\()', 'i') THEN
        respond_error('Only single SELECT statements are allowed', 'REJECTED');
        RETURN;
    END IF;

    -- keyword ban (word boundary, case-insensitive)
    IF REGEXP_LIKE(v_clean,
        '(^|\W)(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|EXECUTE|BEGIN|DECLARE|CALL|LOCK|COMMIT|ROLLBACK)(\W|$)', 'i')
       OR REGEXP_LIKE(v_clean, 'FOR\s+UPDATE', 'i')
       OR REGEXP_LIKE(v_clean, '(^|\W)(DBMS_|UTL_)', 'i')
    THEN
        respond_error('Statement contains a banned keyword - only read-only SELECT is allowed', 'REJECTED');
        RETURN;
    END IF;

    -- row cap: fetch maxRows+1 to detect truncation
    v_wrapped := 'SELECT * FROM (' || v_clean || ') FETCH FIRST '
                 || TO_CHAR(v_max_rows + 1) || ' ROWS ONLY';

    v_t0  := DBMS_UTILITY.GET_TIME;
    v_cur := DBMS_SQL.OPEN_CURSOR;
    DBMS_SQL.PARSE(v_cur, v_wrapped, DBMS_SQL.NATIVE);
    DBMS_SQL.DESCRIBE_COLUMNS2(v_cur, v_col_cnt, v_desc);

    FOR i IN 1 .. v_col_cnt LOOP
        IF v_desc(i).col_type IN (2, 100, 101) THEN            -- NUMBER, FLOAT
            DBMS_SQL.DEFINE_COLUMN(v_cur, i, v_number);
        ELSIF v_desc(i).col_type = 12 THEN                     -- DATE
            DBMS_SQL.DEFINE_COLUMN(v_cur, i, v_date);
        ELSIF v_desc(i).col_type IN (180, 181, 231) THEN       -- TIMESTAMPs
            DBMS_SQL.DEFINE_COLUMN(v_cur, i, v_ts);
        ELSIF v_desc(i).col_type IN (112, 113) THEN            -- CLOB / NCLOB
            DBMS_SQL.DEFINE_COLUMN(v_cur, i, v_clob);
        ELSE                                                   -- text and the rest
            DBMS_SQL.DEFINE_COLUMN(v_cur, i, v_varchar, 4000);
        END IF;
    END LOOP;

    v_dummy := DBMS_SQL.EXECUTE(v_cur);

    -- build the response in a CLOB so an ORA error mid-fetch
    -- cannot corrupt already-sent output
    DBMS_LOB.CREATETEMPORARY(v_json, TRUE);
    emit('{"success"' || CHR(58) || 'true,"columns"' || CHR(58) || '[');
    FOR i IN 1 .. v_col_cnt LOOP
        IF i > 1 THEN
            emit(',');
        END IF;
        emit('"' || APEX_ESCAPE.json(v_desc(i).col_name) || '"');
    END LOOP;
    emit('],"rows"' || CHR(58) || '[');

    WHILE DBMS_SQL.FETCH_ROWS(v_cur) > 0 LOOP
        IF v_rows >= v_max_rows THEN
            v_truncated := TRUE;   -- the extra row exists; do not emit it
            EXIT;
        END IF;
        IF v_rows > 0 THEN
            emit(',');
        END IF;
        emit('[');
        v_first_col := TRUE;
        FOR i IN 1 .. v_col_cnt LOOP
            IF NOT v_first_col THEN
                emit(',');
            END IF;
            v_first_col := FALSE;
            IF v_desc(i).col_type IN (2, 100, 101) THEN
                DBMS_SQL.COLUMN_VALUE(v_cur, i, v_number);
                IF v_number IS NULL THEN
                    emit('null');
                ELSE
                    emit(num_to_json(v_number));
                END IF;
            ELSIF v_desc(i).col_type = 12 THEN
                DBMS_SQL.COLUMN_VALUE(v_cur, i, v_date);
                IF v_date IS NULL THEN
                    emit('null');
                ELSE
                    emit('"' || TO_CHAR(v_date, 'YYYY-MM-DD"T"HH24:MI:SS') || '"');
                END IF;
            ELSIF v_desc(i).col_type IN (180, 181, 231) THEN
                DBMS_SQL.COLUMN_VALUE(v_cur, i, v_ts);
                IF v_ts IS NULL THEN
                    emit('null');
                ELSE
                    emit('"' || TO_CHAR(v_ts, 'YYYY-MM-DD"T"HH24:MI:SS') || '"');
                END IF;
            ELSIF v_desc(i).col_type IN (112, 113) THEN
                DBMS_SQL.COLUMN_VALUE(v_cur, i, v_clob);
                emit_clob(v_clob);
            ELSE
                DBMS_SQL.COLUMN_VALUE(v_cur, i, v_varchar);
                IF v_varchar IS NULL THEN
                    emit('null');
                ELSE
                    emit('"' || APEX_ESCAPE.json(v_varchar) || '"');
                END IF;
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
END wms_ai_execute_query;
/

-- ============================================================
-- VERIFY:  SELECT object_name, status FROM user_objects
--          WHERE object_name = 'WMS_AI_EXECUTE_QUERY';   -- must be VALID
-- Then reload a large form in the Forms Designer — it now loads in full.
-- ============================================================
