-- ============================================================================
-- GET HANDLER #2: Get All Endpoints with Filtering and Pagination
-- URI Template: (blank - root)
-- Method: GET
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
    v_workspace_url         VARCHAR2(500);
    v_endpoint_path         VARCHAR2(500);
    v_http_method           VARCHAR2(10);
    v_description           VARCHAR2(4000);
    v_is_rec_active         VARCHAR2(1);
    v_test_count            NUMBER;
    v_last_test_status      VARCHAR2(20);
    v_last_test_date        TIMESTAMP;
    v_created_date          TIMESTAMP;

    v_first_record          BOOLEAN := TRUE;

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
            HTP.p('"workspace_url":"' || v_workspace_url || '",');
            HTP.p('"endpoint_path":"' || v_endpoint_path || '",');
            HTP.p('"http_method":"' || v_http_method || '",');
            HTP.p('"description":"' || NVL(v_description, '') || '",');
            HTP.p('"is_active":"' || v_is_rec_active || '",');
            HTP.p('"test_count":' || NVL(TO_CHAR(v_test_count), '0') || ',');
            HTP.p('"last_test_status":"' || NVL(v_last_test_status, '') || '",');
            HTP.p('"last_test_date":"' || NVL(TO_CHAR(v_last_test_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), '') || '",');
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

-- ============================================================================
-- APEX CONFIGURATION:
-- ============================================================================
-- 1. Use the ROOT template (blank URI)
-- 2. Create Handler under that template:
--    - Method: GET
--    - Source Type: PL/SQL
--    - Source: (paste the code above)
--
-- 3. Add Parameters (all optional query parameters):
--
--    Parameter: module_code
--    - Bind Variable: module_code
--    - Source Type: URI
--    - Access Method: IN
--    - Data Type: STRING
--    - Required: No
--
--    Parameter: is_active
--    - Bind Variable: is_active
--    - Source Type: URI
--    - Access Method: IN
--    - Data Type: STRING
--    - Required: No
--
--    Parameter: limit
--    - Bind Variable: limit
--    - Source Type: URI
--    - Access Method: IN
--    - Data Type: STRING
--    - Required: No
--
--    Parameter: offset
--    - Bind Variable: offset
--    - Source Type: URI
--    - Access Method: IN
--    - Data Type: STRING
--    - Required: No
--
-- ============================================================================
-- TEST EXAMPLES:
-- ============================================================================
--
-- 1. Get all endpoints:
-- GET https://apex.oracle.com/pls/apex/grays/api/rr/endpoints/
--
-- 2. Get GL endpoints only:
-- GET https://apex.oracle.com/pls/apex/grays/api/rr/endpoints/?module_code=GL
--
-- 3. Get first 10 GL endpoints:
-- GET https://apex.oracle.com/pls/apex/grays/api/rr/endpoints/?module_code=GL&limit=10&offset=0
--
-- 4. Get next 10 GL endpoints (pagination):
-- GET https://apex.oracle.com/pls/apex/grays/api/rr/endpoints/?module_code=GL&limit=10&offset=10
--
-- 5. Get all active endpoints:
-- GET https://apex.oracle.com/pls/apex/grays/api/rr/endpoints/?is_active=Y
--
-- Expected Response:
-- {
--   "status": "SUCCESS",
--   "message": "Endpoints retrieved successfully. Total: 15",
--   "data": {
--     "total_count": 15,
--     "limit": 100,
--     "offset": 0,
--     "endpoints": [
--       {
--         "endpoint_id": 1,
--         "module_code": "GL",
--         "feature_name": "Get Journals",
--         "page_name": "Journal Inquiry",
--         "workspace_url": "https://apex.oracle.com/pls/apex/grays/",
--         "endpoint_path": "api/gl/journals",
--         "http_method": "GET",
--         "description": "Get all journal entries",
--         "is_active": "Y",
--         "test_count": 5,
--         "last_test_status": "SUCCESS",
--         "last_test_date": "2025-11-09T10:30:00Z",
--         "created_date": "2025-11-08T09:00:00Z"
--       },
--       {
--         "endpoint_id": 2,
--         "module_code": "GL",
--         ...
--       }
--     ]
--   }
-- }
-- ============================================================================
