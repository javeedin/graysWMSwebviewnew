-- ============================================================================
-- FIXED: GET /rr/endpoints - CLOB Fix for ORA-00932
-- ============================================================================
-- This fixes ORA-00932 by changing VARCHAR2 to CLOB for large text fields
-- ============================================================================

DECLARE
    v_endpoints_cur SYS_REFCURSOR;
    v_total_count   NUMBER;
    v_status        VARCHAR2(100);
    v_message       VARCHAR2(4000);

    -- Parameters
    v_module_code   VARCHAR2(30);
    v_is_active     VARCHAR2(1);
    v_limit         NUMBER;
    v_offset        NUMBER;

    -- Record variables
    v_endpoint_id           NUMBER;
    v_rec_module_code       VARCHAR2(30);
    v_feature_name          VARCHAR2(100);
    v_page_name             VARCHAR2(100);
    v_workspace_id          NUMBER;
    v_workspace_name        VARCHAR2(100);
    v_environment           VARCHAR2(20);
    v_workspace_url         CLOB;              -- FIXED: VARCHAR2 → CLOB
    v_endpoint_path         CLOB;              -- FIXED: VARCHAR2 → CLOB
    v_http_method           VARCHAR2(10);
    v_description           CLOB;              -- FIXED: VARCHAR2 → CLOB
    v_is_rec_active         VARCHAR2(1);
    v_test_count            NUMBER;
    v_last_test_status      VARCHAR2(20);
    v_last_test_date        DATE;              -- FIXED: TIMESTAMP → DATE
    v_created_date          DATE;              -- FIXED: TIMESTAMP → DATE

    v_first_record          BOOLEAN := TRUE;

    -- Helper function to safely convert CLOB to VARCHAR2
    FUNCTION clob_to_varchar2(p_clob IN CLOB) RETURN VARCHAR2 IS
    BEGIN
        IF p_clob IS NULL THEN
            RETURN '';
        ELSE
            RETURN DBMS_LOB.SUBSTR(p_clob, 4000, 1);
        END IF;
    END;

BEGIN
    -- Get query parameters (from URL)
    v_module_code := :module_code;
    v_is_active   := NVL(:is_active, 'Y');
    v_limit       := NVL(TO_NUMBER(:limit), 100);
    v_offset      := NVL(TO_NUMBER(:offset), 0);

    -- Call the GET ALL procedure
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

    IF v_status = 'SUCCESS' THEN
        -- Start JSON response
        HTP.p('{');
        HTP.p('"status":"SUCCESS",');
        HTP.p('"message":"' || REPLACE(v_message, '"', '\"') || '",');
        HTP.p('"data":{');
        HTP.p('"total_count":' || v_total_count || ',');
        HTP.p('"limit":' || v_limit || ',');
        HTP.p('"offset":' || v_offset || ',');
        HTP.p('"endpoints":[');

        -- Loop through results
        LOOP
            FETCH v_endpoints_cur INTO
                v_endpoint_id, v_rec_module_code, v_feature_name, v_page_name,
                v_workspace_id, v_workspace_name, v_environment,
                v_workspace_url, v_endpoint_path, v_http_method,
                v_description, v_is_rec_active, v_test_count,
                v_last_test_status, v_last_test_date, v_created_date;

            EXIT WHEN v_endpoints_cur%NOTFOUND;

            -- Add comma before each record except the first
            IF NOT v_first_record THEN
                HTP.p(',');
            END IF;
            v_first_record := FALSE;

            -- Build record JSON
            HTP.p('{');
            HTP.p('"endpoint_id":' || v_endpoint_id || ',');
            HTP.p('"module_code":"' || v_rec_module_code || '",');
            HTP.p('"feature_name":"' || v_feature_name || '",');
            HTP.p('"page_name":"' || NVL(v_page_name, '') || '",');
            HTP.p('"workspace_id":' || NVL(TO_CHAR(v_workspace_id), 'null') || ',');
            HTP.p('"workspace_name":"' || NVL(v_workspace_name, '') || '",');
            HTP.p('"environment":"' || NVL(v_environment, '') || '",');

            -- Handle CLOB fields
            HTP.p('"workspace_url":"' || REPLACE(clob_to_varchar2(v_workspace_url), '"', '\"') || '",');
            HTP.p('"endpoint_path":"' || REPLACE(clob_to_varchar2(v_endpoint_path), '"', '\"') || '",');
            HTP.p('"http_method":"' || v_http_method || '",');
            HTP.p('"description":"' || REPLACE(clob_to_varchar2(v_description), '"', '\"') || '",');

            HTP.p('"is_active":"' || v_is_rec_active || '",');
            HTP.p('"test_count":' || NVL(TO_CHAR(v_test_count), '0') || ',');
            HTP.p('"last_test_status":"' || NVL(v_last_test_status, '') || '",');
            HTP.p('"last_test_date":' ||
                CASE WHEN v_last_test_date IS NULL
                     THEN 'null'
                     ELSE '"' || TO_CHAR(v_last_test_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '"'
                END || ',');
            HTP.p('"created_date":"' || TO_CHAR(v_created_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '"');
            HTP.p('}');
        END LOOP;

        CLOSE v_endpoints_cur;

        -- Close JSON response
        HTP.p(']');
        HTP.p('}');
        HTP.p('}');
    ELSE
        HTP.p('{"status":"' || v_status || '","message":"' || REPLACE(v_message, '"', '\"') || '"}');
    END IF;

EXCEPTION
    WHEN OTHERS THEN
        IF v_endpoints_cur%ISOPEN THEN
            CLOSE v_endpoints_cur;
        END IF;
        HTP.p('{"status":"ERROR","message":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
/

-- ============================================================================
-- SETUP INSTRUCTIONS
-- ============================================================================
/*
1. Go to APEX → SQL Workshop → RESTful Services → rr module
2. Find the GET /rr/endpoints handler
3. Replace the code with this fixed version
4. Click "Apply Changes"
5. Test the endpoint

KEY FIXES:
1. Changed v_workspace_url from VARCHAR2(500) to CLOB
2. Changed v_endpoint_path from VARCHAR2(500) to CLOB
3. Changed v_description from VARCHAR2(4000) to CLOB
4. Changed v_last_test_date from TIMESTAMP to DATE
5. Changed v_created_date from TIMESTAMP to DATE
6. Added helper function to safely convert CLOB to VARCHAR2 for JSON output

This should resolve the ORA-00932 datatype error completely.
*/
