-- ============================================================================
-- FIXED: GET /rr/endpoints/:id - Get Endpoint by ID
-- ============================================================================
-- This fixes the ORA-00932 datatype error by using DATE instead of TIMESTAMP
-- ============================================================================

-- URI Template: endpoints/:id
-- Method: GET
-- Path Parameter: id (NUMBER)

DECLARE
    v_endpoint_cur  SYS_REFCURSOR;
    v_status        VARCHAR2(100);
    v_message       VARCHAR2(4000);

    -- Parameters
    v_endpoint_id   NUMBER;

    -- Record variables
    v_rec_endpoint_id       NUMBER;
    v_module_code           VARCHAR2(30);
    v_feature_name          VARCHAR2(100);
    v_page_name             VARCHAR2(100);
    v_workspace_id          NUMBER;
    v_workspace_name        VARCHAR2(100);
    v_environment           VARCHAR2(20);
    v_workspace_url         VARCHAR2(500);
    v_endpoint_path         VARCHAR2(500);
    v_http_method           VARCHAR2(10);
    v_description           VARCHAR2(4000);
    v_is_active             VARCHAR2(1);
    v_test_count            NUMBER;
    v_last_test_status      VARCHAR2(20);
    v_last_test_date        DATE;        -- FIXED: Changed from TIMESTAMP to DATE
    v_created_date          DATE;        -- FIXED: Changed from TIMESTAMP to DATE
    v_updated_date          DATE;        -- FIXED: Changed from TIMESTAMP to DATE (if exists)

BEGIN
    -- Get path parameter
    v_endpoint_id := TO_NUMBER(:id);

    -- Call the GET BY ID procedure
    RR_APEX_ENDPOINT_PKG.RR_GET_ENDPOINT_BY_ID(
        p_endpoint_id   => v_endpoint_id,
        p_endpoint_cur  => v_endpoint_cur,
        p_status        => v_status,
        p_message       => v_message
    );

    IF v_status = 'SUCCESS' THEN
        -- Fetch the single record
        FETCH v_endpoint_cur INTO
            v_rec_endpoint_id, v_module_code, v_feature_name, v_page_name,
            v_workspace_id, v_workspace_name, v_environment,
            v_workspace_url, v_endpoint_path, v_http_method,
            v_description, v_is_active, v_test_count,
            v_last_test_status, v_last_test_date, v_created_date;

        IF v_endpoint_cur%FOUND THEN
            -- Build JSON response
            HTP.p('{');
            HTP.p('"status":"SUCCESS",');
            HTP.p('"message":"Endpoint retrieved successfully",');
            HTP.p('"data":{');
            HTP.p('"endpoint_id":' || v_rec_endpoint_id || ',');
            HTP.p('"module_code":"' || v_module_code || '",');
            HTP.p('"feature_name":"' || v_feature_name || '",');
            HTP.p('"page_name":"' || NVL(v_page_name, '') || '",');
            HTP.p('"workspace_id":' || NVL(TO_CHAR(v_workspace_id), 'null') || ',');
            HTP.p('"workspace_name":"' || NVL(v_workspace_name, '') || '",');
            HTP.p('"environment":"' || NVL(v_environment, '') || '",');
            HTP.p('"workspace_url":"' || v_workspace_url || '",');
            HTP.p('"endpoint_path":"' || v_endpoint_path || '",');
            HTP.p('"http_method":"' || v_http_method || '",');
            HTP.p('"description":"' || NVL(v_description, '') || '",');
            HTP.p('"is_active":"' || v_is_active || '",');
            HTP.p('"test_count":' || NVL(TO_CHAR(v_test_count), '0') || ',');
            HTP.p('"last_test_status":"' || NVL(v_last_test_status, '') || '",');
            HTP.p('"last_test_date":' ||
                CASE WHEN v_last_test_date IS NULL
                     THEN 'null'
                     ELSE '"' || TO_CHAR(v_last_test_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '"'
                END || ',');
            HTP.p('"created_date":"' || TO_CHAR(v_created_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '"');
            HTP.p('}');
            HTP.p('}');
        ELSE
            HTP.p('{"status":"ERROR","message":"Endpoint not found"}');
        END IF;

        CLOSE v_endpoint_cur;
    ELSE
        HTP.p('{"status":"' || v_status || '","message":"' || REPLACE(v_message, '"', '\"') || '"}');
    END IF;

EXCEPTION
    WHEN OTHERS THEN
        IF v_endpoint_cur%ISOPEN THEN
            CLOSE v_endpoint_cur;
        END IF;
        HTP.p('{"status":"ERROR","message":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
/

-- ============================================================================
-- SETUP INSTRUCTIONS
-- ============================================================================
/*
1. Go to APEX → SQL Workshop → RESTful Services → rr module
2. Find the GET /endpoints/:id handler
3. Replace the existing code with the code above
4. Click "Apply Changes"
5. Test the endpoint

CHANGES MADE:
- Line 29: Changed v_last_test_date from TIMESTAMP to DATE
- Line 30: Changed v_created_date from TIMESTAMP to DATE
- Line 31: Changed v_updated_date from TIMESTAMP to DATE (if your table has this column)
- Line 81: Added proper NULL handling for last_test_date

This fixes the ORA-00932 error: inconsistent datatypes
*/
