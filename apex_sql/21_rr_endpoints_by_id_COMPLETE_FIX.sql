-- ============================================================================
-- COMPLETE FIX: GET /rr/endpoints/:id - Get Single Endpoint by ID
-- ============================================================================
-- Based on exact cursor structure (all 42 columns)
-- ============================================================================

DECLARE
    v_endpoint_cur  SYS_REFCURSOR;
    v_status        VARCHAR2(100);
    v_message       VARCHAR2(4000);

    -- Parameters
    v_endpoint_id   NUMBER;

    -- ALL 42 columns from the cursor (exact datatypes)
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

    -- Helper to safely convert CLOB to JSON string
    FUNCTION safe_clob(p_clob CLOB) RETURN VARCHAR2 IS
    BEGIN
        IF p_clob IS NULL THEN
            RETURN '';
        ELSIF DBMS_LOB.GETLENGTH(p_clob) > 2000 THEN
            RETURN REPLACE(DBMS_LOB.SUBSTR(p_clob, 2000, 1), '"', '\"') || '...';
        ELSE
            RETURN REPLACE(DBMS_LOB.SUBSTR(p_clob, 4000, 1), '"', '\"');
        END IF;
    END;

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
        -- Fetch the single record - ALL 42 COLUMNS
        FETCH v_endpoint_cur INTO
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
            v_last_update_date, v_last_updated_by, v_workspace_name, v_environment;

        IF v_endpoint_cur%FOUND THEN
            -- Build complete JSON response
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
            HTP.p('"request_params":"' || safe_clob(v_request_params) || '",');
            HTP.p('"sample_request_body":"' || safe_clob(v_sample_request_body) || '",');
            HTP.p('"sample_response":"' || safe_clob(v_sample_response) || '",');
            HTP.p('"response_format":"' || NVL(v_response_format, '') || '",');
            HTP.p('"content_type":"' || NVL(v_content_type, '') || '",');
            HTP.p('"requires_auth":"' || NVL(v_requires_auth, 'N') || '",');
            HTP.p('"auth_type":"' || NVL(v_auth_type, '') || '",');
            HTP.p('"auth_header_name":"' || NVL(v_auth_header_name, '') || '",');
            HTP.p('"auth_value_encrypted":"' || NVL(v_auth_value_encrypted, '') || '",');
            HTP.p('"timeout_seconds":' || NVL(TO_CHAR(v_timeout_seconds), 'null') || ',');
            HTP.p('"retry_count":' || NVL(TO_CHAR(v_retry_count), '0') || ',');
            HTP.p('"cache_enabled":"' || NVL(v_cache_enabled, 'N') || '",');
            HTP.p('"cache_duration_seconds":' || NVL(TO_CHAR(v_cache_duration_seconds), 'null') || ',');
            HTP.p('"last_test_date":' ||
                CASE WHEN v_last_test_date IS NULL THEN 'null'
                     ELSE '"' || TO_CHAR(v_last_test_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '"'
                END || ',');
            HTP.p('"last_test_status":"' || NVL(v_last_test_status, '') || '",');
            HTP.p('"last_test_response":"' || safe_clob(v_last_test_response) || '",');
            HTP.p('"last_test_duration_ms":' || NVL(TO_CHAR(v_last_test_duration_ms), 'null') || ',');
            HTP.p('"last_test_error":"' || NVL(REPLACE(v_last_test_error, '"', '\"'), '') || '",');
            HTP.p('"test_count":' || NVL(TO_CHAR(v_test_count), '0') || ',');
            HTP.p('"success_count":' || NVL(TO_CHAR(v_success_count), '0') || ',');
            HTP.p('"failure_count":' || NVL(TO_CHAR(v_failure_count), '0') || ',');
            HTP.p('"copilot_enabled":"' || NVL(v_copilot_enabled, 'N') || '",');
            HTP.p('"copilot_prompt":"' || NVL(REPLACE(v_copilot_prompt, '"', '\"'), '') || '",');
            HTP.p('"copilot_parameters":"' || safe_clob(v_copilot_parameters) || '",');
            HTP.p('"is_active":"' || NVL(v_is_active, 'N') || '",');
            HTP.p('"description":"' || NVL(REPLACE(v_description, '"', '\"'), '') || '",');
            HTP.p('"notes":"' || safe_clob(v_notes) || '",');
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
-- THIS IS THE COMPLETE FIX FOR GET BY ID!
-- ============================================================================
/*
FIXES:
- Fetches all 42 columns (same as GET all endpoints)
- Correct datatypes: TIMESTAMP for LAST_TEST_DATE, CLOB for 7 fields, DATE for 2 fields
- Returns complete endpoint information with all fields
- Includes proper error handling

APPLY TO: GET /rr/endpoints/:id handler in APEX
*/
