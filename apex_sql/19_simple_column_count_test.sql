-- ============================================================================
-- SIMPLE TEST: Count how many columns the cursor actually returns
-- ============================================================================

DECLARE
    v_endpoints_cur SYS_REFCURSOR;
    v_total_count   NUMBER;
    v_status        VARCHAR2(100);
    v_message       VARCHAR2(4000);

    v_module_code   VARCHAR2(30);
    v_is_active     VARCHAR2(1);
    v_limit         NUMBER := 1;
    v_offset        NUMBER := 0;

    v_col_count     NUMBER := 0;
    v_desc_tab      DBMS_SQL.DESC_TAB;
    v_cursor_id     NUMBER;

BEGIN
    v_module_code := :module_code;
    v_is_active   := NVL(:is_active, 'Y');

    -- Call procedure
    RR_APEX_ENDPOINT_PKG.RR_GET_ALL_ENDPOINTS(
        p_module_code   => v_module_code,
        p_is_active     => v_is_active,
        p_limit         => v_limit,
        p_offset        => v_offset,
        p_endpoints_cur => v_endpoints_cur,
        p_total_count   => v_total_count,
        p_status        => v_status,
        p_message       => v_message
    );

    -- Convert REF CURSOR to DBMS_SQL cursor to describe it
    v_cursor_id := DBMS_SQL.TO_CURSOR_NUMBER(v_endpoints_cur);

    -- Describe the cursor columns
    DBMS_SQL.DESCRIBE_COLUMNS(v_cursor_id, v_col_count, v_desc_tab);

    -- Build JSON with column info
    HTP.p('{');
    HTP.p('"status":"SUCCESS",');
    HTP.p('"procedure_status":"' || v_status || '",');
    HTP.p('"column_count":' || v_col_count || ',');
    HTP.p('"columns":[');

    FOR i IN 1..v_col_count LOOP
        IF i > 1 THEN
            HTP.p(',');
        END IF;
        HTP.p('{');
        HTP.p('"position":' || i || ',');
        HTP.p('"name":"' || v_desc_tab(i).col_name || '",');
        HTP.p('"type":' || v_desc_tab(i).col_type || ',');
        HTP.p('"type_name":"' ||
            CASE v_desc_tab(i).col_type
                WHEN 1 THEN 'VARCHAR2'
                WHEN 2 THEN 'NUMBER'
                WHEN 8 THEN 'LONG'
                WHEN 12 THEN 'DATE'
                WHEN 112 THEN 'CLOB'
                WHEN 113 THEN 'BLOB'
                WHEN 180 THEN 'TIMESTAMP'
                WHEN 181 THEN 'TIMESTAMP_WITH_TZ'
                WHEN 231 THEN 'TIMESTAMP_WITH_LOCAL_TZ'
                ELSE 'TYPE_' || v_desc_tab(i).col_type
            END || '",');
        HTP.p('"max_length":' || v_desc_tab(i).col_max_len);
        HTP.p('}');
    END LOOP;

    HTP.p(']');
    HTP.p('}');

    DBMS_SQL.CLOSE_CURSOR(v_cursor_id);

EXCEPTION
    WHEN OTHERS THEN
        HTP.p('{"status":"ERROR","message":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
        IF DBMS_SQL.IS_OPEN(v_cursor_id) THEN
            DBMS_SQL.CLOSE_CURSOR(v_cursor_id);
        END IF;
END;
/

-- ============================================================================
-- INSTRUCTIONS
-- ============================================================================
/*
1. Replace your GET /rr/endpoints handler with this code
2. Test the endpoint
3. Share the COMPLETE output with me

This will show:
- Exact number of columns returned
- Name of each column
- Datatype of each column (as a number and name)
- Max length

This will tell us EXACTLY what the procedure returns!
*/
