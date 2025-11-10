-- ============================================================================
-- GET HANDLER #1: Get Single Endpoint by ID
-- URI Template: :endpoint_id
-- Method: GET
-- ============================================================================

DECLARE
    v_endpoint_rec  SYS_REFCURSOR;
    v_status        VARCHAR2(100);
    v_message       VARCHAR2(4000);

    -- Variables to hold the record data
    v_endpoint_id           NUMBER;
    v_module_code           VARCHAR2(30);
    v_feature_name          VARCHAR2(100);
    v_page_name             VARCHAR2(100);
    v_workspace_id          NUMBER;
    v_workspace_name        VARCHAR2(100);
    v_environment           VARCHAR2(20);
    v_workspace_url         VARCHAR2(500);
    v_endpoint_path         VARCHAR2(500);
    v_http_method           VARCHAR2(10);
    v_request_params        CLOB;
    v_sample_request_body   CLOB;
    v_sample_response       CLOB;
    v_response_format       VARCHAR2(20);
    v_content_type          VARCHAR2(100);
    v_requires_auth         VARCHAR2(1);
    v_auth_type             VARCHAR2(20);
    v_timeout_seconds       NUMBER;
    v_retry_count           NUMBER;
    v_cache_enabled         VARCHAR2(1);
    v_cache_duration_seconds NUMBER;
    v_copilot_enabled       VARCHAR2(1);
    v_copilot_prompt        VARCHAR2(4000);
    v_is_active             VARCHAR2(1);
    v_description           VARCHAR2(4000);
    v_tags                  VARCHAR2(500);
    v_test_count            NUMBER;
    v_last_test_date        TIMESTAMP;
    v_last_test_status      VARCHAR2(20);
    v_created_date          TIMESTAMP;
    v_created_by            NUMBER;
    v_last_update_date      TIMESTAMP;
    v_last_updated_by       NUMBER;

BEGIN
    -- Call the GET procedure
    RR_APEX_ENDPOINT_PKG.RR_GET_ENDPOINT(
        p_endpoint_id   => TO_NUMBER(:endpoint_id),
        p_endpoint_rec  => v_endpoint_rec,
        p_status        => v_status,
        p_message       => v_message
    );

    IF v_status = 'SUCCESS' THEN
        -- Fetch the record
        FETCH v_endpoint_rec INTO
            v_endpoint_id, v_module_code, v_feature_name, v_page_name,
            v_workspace_id, v_workspace_url, v_endpoint_path, v_http_method,
            v_request_params, v_sample_request_body, v_sample_response,
            v_response_format, v_content_type, v_requires_auth, v_auth_type,
            v_timeout_seconds, v_retry_count, v_cache_enabled, v_cache_duration_seconds,
            v_copilot_enabled, v_copilot_prompt, v_is_active, v_description,
            v_tags, v_test_count, v_last_test_date, v_last_test_status,
            v_created_date, v_created_by, v_last_update_date, v_last_updated_by,
            v_workspace_name, v_environment;

        CLOSE v_endpoint_rec;

        -- Build JSON response
        HTP.p('{');
        HTP.p('"status":"SUCCESS",');
        HTP.p('"message":"Endpoint retrieved successfully",');
        HTP.p('"data":{');
        HTP.p('"endpoint_id":' || v_endpoint_id || ',');
        HTP.p('"module_code":"' || v_module_code || '",');
        HTP.p('"feature_name":"' || v_feature_name || '",');
        HTP.p('"page_name":"' || NVL(v_page_name, '') || '",');
        HTP.p('"workspace_id":' || NVL(TO_CHAR(v_workspace_id), 'null') || ',');
        HTP.p('"workspace_name":"' || NVL(v_workspace_name, '') || '",');
        HTP.p('"environment":"' || NVL(v_environment, '') || '",');
        HTP.p('"workspace_url":"' || v_workspace_url || '",');
        HTP.p('"endpoint_path":"' || v_endpoint_path || '",');
        HTP.p('"http_method":"' || v_http_method || '",');
        HTP.p('"request_params":' || NVL(v_request_params, 'null') || ',');
        HTP.p('"sample_request_body":' || NVL(v_sample_request_body, 'null') || ',');
        HTP.p('"sample_response":' || NVL(v_sample_response, 'null') || ',');
        HTP.p('"response_format":"' || NVL(v_response_format, 'JSON') || '",');
        HTP.p('"content_type":"' || NVL(v_content_type, 'application/json') || '",');
        HTP.p('"requires_auth":"' || NVL(v_requires_auth, 'N') || '",');
        HTP.p('"auth_type":"' || NVL(v_auth_type, 'NONE') || '",');
        HTP.p('"timeout_seconds":' || NVL(TO_CHAR(v_timeout_seconds), '30') || ',');
        HTP.p('"retry_count":' || NVL(TO_CHAR(v_retry_count), '0') || ',');
        HTP.p('"cache_enabled":"' || NVL(v_cache_enabled, 'N') || '",');
        HTP.p('"cache_duration_seconds":' || NVL(TO_CHAR(v_cache_duration_seconds), 'null') || ',');
        HTP.p('"copilot_enabled":"' || NVL(v_copilot_enabled, 'N') || '",');
        HTP.p('"copilot_prompt":"' || NVL(v_copilot_prompt, '') || '",');
        HTP.p('"is_active":"' || NVL(v_is_active, 'Y') || '",');
        HTP.p('"description":"' || NVL(v_description, '') || '",');
        HTP.p('"tags":"' || NVL(v_tags, '') || '",');
        HTP.p('"test_count":' || NVL(TO_CHAR(v_test_count), '0') || ',');
        HTP.p('"last_test_date":"' || NVL(TO_CHAR(v_last_test_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), '') || '",');
        HTP.p('"last_test_status":"' || NVL(v_last_test_status, '') || '",');
        HTP.p('"created_date":"' || TO_CHAR(v_created_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '",');
        HTP.p('"created_by":' || v_created_by || ',');
        HTP.p('"last_update_date":"' || TO_CHAR(v_last_update_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '",');
        HTP.p('"last_updated_by":' || v_last_updated_by);
        HTP.p('}');
        HTP.p('}');
    ELSE
        HTP.p('{"status":"' || v_status || '","message":"' || REPLACE(v_message, '"', '\"') || '"}');
    END IF;

EXCEPTION
    WHEN OTHERS THEN
        HTP.p('{"status":"ERROR","message":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;

-- ============================================================================
-- APEX CONFIGURATION:
-- ============================================================================
-- 1. Create Resource Template: :endpoint_id
-- 2. Create Handler under that template:
--    - Method: GET
--    - Source Type: PL/SQL
--    - Source: (paste the code above)
--
-- 3. Add Parameter:
--    Parameter Name: endpoint_id
--    - Bind Variable: endpoint_id
--    - Source Type: URI
--    - Access Method: IN
--    - Data Type: STRING
--    - Required: Yes
--
-- ============================================================================
-- TEST:
-- GET https://apex.oracle.com/pls/apex/grays/api/rr/endpoints/1
--
-- Expected Response:
-- {
--   "status": "SUCCESS",
--   "message": "Endpoint retrieved successfully",
--   "data": {
--     "endpoint_id": 1,
--     "module_code": "GL",
--     "feature_name": "Get Journals",
--     ...
--   }
-- }
-- ============================================================================
