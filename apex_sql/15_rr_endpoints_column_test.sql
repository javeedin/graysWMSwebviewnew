-- ============================================================================
-- COLUMN-BY-COLUMN DIAGNOSTIC - Find the exact problematic column
-- ============================================================================
-- This will test fetching columns one by one to identify the mismatch
-- ============================================================================

DECLARE
    v_endpoints_cur SYS_REFCURSOR;
    v_total_count   NUMBER;
    v_status        VARCHAR2(100);
    v_message       VARCHAR2(4000);
    v_module_code   VARCHAR2(30);
    v_is_active     VARCHAR2(1);
    v_limit         NUMBER := 1;  -- Fetch only 1 row for testing
    v_offset        NUMBER := 0;

    -- Test variables with most flexible types
    v_col1  VARCHAR2(4000);
    v_col2  VARCHAR2(4000);
    v_col3  VARCHAR2(4000);
    v_col4  VARCHAR2(4000);
    v_col5  VARCHAR2(4000);
    v_col6  VARCHAR2(4000);
    v_col7  VARCHAR2(4000);
    v_col8  VARCHAR2(4000);
    v_col9  VARCHAR2(4000);
    v_col10 VARCHAR2(4000);
    v_col11 VARCHAR2(4000);
    v_col12 VARCHAR2(4000);
    v_col13 VARCHAR2(4000);
    v_col14 VARCHAR2(4000);
    v_col15 VARCHAR2(4000);
    v_col16 VARCHAR2(4000);
    v_col17 VARCHAR2(4000);
    v_col18 VARCHAR2(4000);
    v_col19 VARCHAR2(4000);
    v_col20 VARCHAR2(4000);

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

    HTP.p('{');
    HTP.p('"test":"column_count_detection",');
    HTP.p('"procedure_status":"' || v_status || '",');

    -- Try fetching with different column counts
    BEGIN
        -- Try 16 columns (original)
        FETCH v_endpoints_cur INTO
            v_col1, v_col2, v_col3, v_col4, v_col5, v_col6, v_col7, v_col8,
            v_col9, v_col10, v_col11, v_col12, v_col13, v_col14, v_col15, v_col16;

        IF v_endpoints_cur%FOUND THEN
            HTP.p('"columns_found":16,');
            HTP.p('"col1":"' || SUBSTR(v_col1, 1, 50) || '",');
            HTP.p('"col2":"' || SUBSTR(v_col2, 1, 50) || '",');
            HTP.p('"col3":"' || SUBSTR(v_col3, 1, 50) || '",');
            HTP.p('"col4":"' || SUBSTR(v_col4, 1, 50) || '",');
            HTP.p('"col5":"' || SUBSTR(v_col5, 1, 50) || '",');
            HTP.p('"col6":"' || SUBSTR(v_col6, 1, 50) || '",');
            HTP.p('"col7":"' || SUBSTR(v_col7, 1, 50) || '",');
            HTP.p('"col8":"' || SUBSTR(v_col8, 1, 50) || '",');
            HTP.p('"col9":"' || SUBSTR(v_col9, 1, 50) || '",');
            HTP.p('"col10":"' || SUBSTR(v_col10, 1, 50) || '",');
            HTP.p('"col11":"' || SUBSTR(v_col11, 1, 50) || '",');
            HTP.p('"col12":"' || SUBSTR(v_col12, 1, 50) || '",');
            HTP.p('"col13":"' || SUBSTR(v_col13, 1, 50) || '",');
            HTP.p('"col14":"' || SUBSTR(v_col14, 1, 50) || '",');
            HTP.p('"col15":"' || SUBSTR(v_col15, 1, 50) || '",');
            HTP.p('"col16":"' || SUBSTR(v_col16, 1, 50) || '",');
            HTP.p('"result":"SUCCESS - 16 columns work!"');
        END IF;

    EXCEPTION
        WHEN OTHERS THEN
            HTP.p('"error_16_cols":"' || REPLACE(SQLERRM, '"', '\"') || '"');
    END;

    CLOSE v_endpoints_cur;
    HTP.p('}');

EXCEPTION
    WHEN OTHERS THEN
        HTP.p('{"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
/

-- ============================================================================
-- INSTRUCTIONS
-- ============================================================================
/*
This will help us understand:
1. Does the cursor return 16 columns?
2. What are the actual values in each column?
3. Which specific datatype is causing the issue?

After running this, share the output with me.
*/
