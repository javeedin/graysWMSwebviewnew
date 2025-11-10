-- ============================================================================
-- FIX: GET /rr/endpoints/:id - Direct Query (no separate procedure)
-- ============================================================================
-- Since RR_GET_ENDPOINT_BY_ID doesn't exist, query directly
-- ============================================================================

DECLARE
    v_endpoint_id   NUMBER;

    -- ALL 42 columns
    v_rec_endpoint_id           NUMBER;
    v_module_code               VARCHAR2(30);
    v_feature_name              VARCHAR2(100);
    v_page_name                 VARCHAR2(100);
    v_workspace_id              NUMBER;
    v_workspace_url             VARCHAR2(500);
    v_endpoint_path             VARCHAR2(500);
    v_http_method               VARCHAR2(10);
    v_request_params            CLOB;
    v_sample_request_body       CLOB;
    v_sample_response           CLOB;
    v_response_format           VARCHAR2(20);
    v_content_type              VARCHAR2(100);
    v_requires_auth             VARCHAR2(1);
    v_auth_type                 VARCHAR2(20);
    v_auth_header_name          VARCHAR2(100);
    v_auth_value_encrypted      VARCHAR2(1000);
    v_timeout_seconds           NUMBER;
    v_retry_count               NUMBER;
    v_cache_enabled             VARCHAR2(1);
    v_cache_duration_seconds    NUMBER;
    v_last_test_date            TIMESTAMP;
    v_last_test_status          VARCHAR2(20);
    v_last_test_response        CLOB;
    v_last_test_duration_ms     NUMBER;
    v_last_test_error           VARCHAR2(1000);
    v_test_count                NUMBER;
    v_success_count             NUMBER;
    v_failure_count             NUMBER;
    v_copilot_enabled           VARCHAR2(1);
    v_copilot_prompt            VARCHAR2(1000);
    v_copilot_parameters        CLOB;
    v_is_active                 VARCHAR2(1);
    v_description               VARCHAR2(500);
    v_notes                     CLOB;
    v_tags                      VARCHAR2(500);
    v_created_date              DATE;
    v_created_by                NUMBER;
    v_last_update_date          DATE;
    v_last_updated_by           NUMBER;
    v_workspace_name            VARCHAR2(100);
    v_environment               VARCHAR2(20);

    v_found                     BOOLEAN := FALSE;

BEGIN
    -- Get path parameter
    v_endpoint_id := TO_NUMBER(:id);

    -- Query directly from the table with JOIN for workspace info
    BEGIN
        SELECT
            e.ENDPOINT_ID,
            e.MODULE_CODE,
            e.FEATURE_NAME,
            e.PAGE_NAME,
            e.WORKSPACE_ID,
            e.WORKSPACE_URL,
            e.ENDPOINT_PATH,
            e.HTTP_METHOD,
            e.REQUEST_PARAMS,
            e.SAMPLE_REQUEST_BODY,
            e.SAMPLE_RESPONSE,
            e.RESPONSE_FORMAT,
            e.CONTENT_TYPE,
            e.REQUIRES_AUTH,
            e.AUTH_TYPE,
            e.AUTH_HEADER_NAME,
            e.AUTH_VALUE_ENCRYPTED,
            e.TIMEOUT_SECONDS,
            e.RETRY_COUNT,
            e.CACHE_ENABLED,
            e.CACHE_DURATION_SECONDS,
            e.LAST_TEST_DATE,
            e.LAST_TEST_STATUS,
            e.LAST_TEST_RESPONSE,
            e.LAST_TEST_DURATION_MS,
            e.LAST_TEST_ERROR,
            e.TEST_COUNT,
            e.SUCCESS_COUNT,
            e.FAILURE_COUNT,
            e.COPILOT_ENABLED,
            e.COPILOT_PROMPT,
            e.COPILOT_PARAMETERS,
            e.IS_ACTIVE,
            e.DESCRIPTION,
            e.NOTES,
            e.TAGS,
            e.CREATED_DATE,
            e.CREATED_BY,
            e.LAST_UPDATE_DATE,
            e.LAST_UPDATED_BY,
            NULL AS WORKSPACE_NAME,  -- Adjust if you have workspace table
            NULL AS ENVIRONMENT      -- Adjust if you have workspace table
        INTO
            v_rec_endpoint_id, v_module_code, v_feature_name, v_page_name,
            v_workspace_id, v_workspace_url, v_endpoint_path, v_http_method,
            v_request_params, v_sample_request_body, v_sample_response,
            v_response_format, v_content_type, v_requires_auth, v_auth_type,
            v_auth_header_name, v_auth_value_encrypted, v_timeout_seconds,
            v_retry_count, v_cache_enabled, v_cache_duration_seconds,
            v_last_test_date, v_last_test_status, v_last_test_response,
            v_last_test_duration_ms, v_last_test_error, v_test_count,
            v_success_count, v_failure_count, v_copilot_enabled,
            v_copilot_prompt, v_copilot_parameters, v_is_active,
            v_description, v_notes, v_tags, v_created_date, v_created_by,
            v_last_update_date, v_last_updated_by, v_workspace_name, v_environment
        FROM RR_ENDPOINTS e
        WHERE e.ENDPOINT_ID = v_endpoint_id;

        v_found := TRUE;

    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            v_found := FALSE;
    END;

    IF v_found THEN
        -- Build JSON response
        HTP.p('{');
        HTP.p('"status":"SUCCESS",');
        HTP.p('"message":"Endpoint retrieved successfully",');
        HTP.p('"data":{');
        HTP.p('"endpoint_id":' || v_rec_endpoint_id || ',');
        HTP.p('"module_code":"' || NVL(v_module_code, '') || '",');
        HTP.p('"feature_name":"' || NVL(v_feature_name, '') || '",');
        HTP.p('"page_name":"' || NVL(v_page_name, '') || '",');
        HTP.p('"workspace_id":' || NVL(TO_CHAR(v_workspace_id), 'null') || ',');
        HTP.p('"workspace_name":"' || NVL(v_workspace_name, '') || '",');
        HTP.p('"environment":"' || NVL(v_environment, '') || '",');
        HTP.p('"workspace_url":"' || NVL(v_workspace_url, '') || '",');
        HTP.p('"endpoint_path":"' || NVL(v_endpoint_path, '') || '",');
        HTP.p('"http_method":"' || NVL(v_http_method, '') || '",');
        HTP.p('"response_format":"' || NVL(v_response_format, '') || '",');
        HTP.p('"content_type":"' || NVL(v_content_type, '') || '",');
        HTP.p('"requires_auth":"' || NVL(v_requires_auth, 'N') || '",');
        HTP.p('"auth_type":"' || NVL(v_auth_type, '') || '",');
        HTP.p('"timeout_seconds":' || NVL(TO_CHAR(v_timeout_seconds), 'null') || ',');
        HTP.p('"retry_count":' || NVL(TO_CHAR(v_retry_count), '0') || ',');
        HTP.p('"cache_enabled":"' || NVL(v_cache_enabled, 'N') || '",');
        HTP.p('"cache_duration_seconds":' || NVL(TO_CHAR(v_cache_duration_seconds), 'null') || ',');
        HTP.p('"last_test_date":' ||
            CASE WHEN v_last_test_date IS NULL THEN 'null'
                 ELSE '"' || TO_CHAR(v_last_test_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '"'
            END || ',');
        HTP.p('"last_test_status":"' || NVL(v_last_test_status, '') || '",');
        HTP.p('"last_test_duration_ms":' || NVL(TO_CHAR(v_last_test_duration_ms), 'null') || ',');
        HTP.p('"last_test_error":"' || NVL(REPLACE(SUBSTR(v_last_test_error, 1, 200), '"', '\"'), '') || '",');
        HTP.p('"test_count":' || NVL(TO_CHAR(v_test_count), '0') || ',');
        HTP.p('"success_count":' || NVL(TO_CHAR(v_success_count), '0') || ',');
        HTP.p('"failure_count":' || NVL(TO_CHAR(v_failure_count), '0') || ',');
        HTP.p('"copilot_enabled":"' || NVL(v_copilot_enabled, 'N') || '",');
        HTP.p('"is_active":"' || NVL(v_is_active, 'N') || '",');
        HTP.p('"description":"' || NVL(REPLACE(v_description, '"', '\"'), '') || '",');
        HTP.p('"tags":"' || NVL(v_tags, '') || '",');
        HTP.p('"created_date":' ||
            CASE WHEN v_created_date IS NULL THEN 'null'
                 ELSE '"' || TO_CHAR(v_created_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '"'
            END || ',');
        HTP.p('"created_by":' || NVL(TO_CHAR(v_created_by), 'null') || ',');
        HTP.p('"last_update_date":' ||
            CASE WHEN v_last_update_date IS NULL THEN 'null'
                 ELSE '"' || TO_CHAR(v_last_update_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '"'
            END || ',');
        HTP.p('"last_updated_by":' || NVL(TO_CHAR(v_last_updated_by), 'null'));
        HTP.p('}');
        HTP.p('}');
    ELSE
        HTP.p('{"status":"ERROR","message":"Endpoint not found with ID ' || v_endpoint_id || '"}');
    END IF;

EXCEPTION
    WHEN OTHERS THEN
        HTP.p('{"status":"ERROR","message":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
/

-- ============================================================================
-- INSTRUCTIONS
-- ============================================================================
/*
This version queries directly from RR_ENDPOINTS table instead of using
a non-existent procedure.

Apply this to: GET /rr/endpoints/:id handler in APEX

Note: WORKSPACE_NAME and ENVIRONMENT are set to NULL. If you have a workspace
table to JOIN, update the query accordingly.
*/
