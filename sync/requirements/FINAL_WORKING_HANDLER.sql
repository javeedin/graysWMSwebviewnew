-- ============================================================================
-- FINAL WORKING APEX REST HANDLER
-- This version uses APEX_JSON which handles headers automatically
-- No OWA_UTIL or HTP - cleaner and more reliable
-- ============================================================================

DECLARE
    v_endpoint_id   NUMBER;
    v_status        VARCHAR2(100);
    v_message       VARCHAR2(4000);
    v_body          CLOB;
BEGIN
    -- Get and parse request body
    v_body := :body;
    APEX_JSON.parse(v_body);

    -- Call the package procedure
    RR_APEX_ENDPOINT_PKG.RR_CREATE_ENDPOINT(
        p_module_code           => APEX_JSON.get_varchar2(p_path => 'module_code'),
        p_feature_name          => APEX_JSON.get_varchar2(p_path => 'feature_name'),
        p_http_method           => APEX_JSON.get_varchar2(p_path => 'http_method'),
        p_workspace_url         => APEX_JSON.get_varchar2(p_path => 'workspace_url'),
        p_endpoint_path         => APEX_JSON.get_varchar2(p_path => 'endpoint_path'),
        p_page_name             => APEX_JSON.get_varchar2(p_path => 'page_name'),
        p_workspace_id          => APEX_JSON.get_number(p_path => 'workspace_id'),
        p_request_params        => APEX_JSON.get_clob(p_path => 'request_params'),
        p_sample_request_body   => APEX_JSON.get_clob(p_path => 'sample_request_body'),
        p_sample_response       => APEX_JSON.get_clob(p_path => 'sample_response'),
        p_response_format       => NVL(APEX_JSON.get_varchar2(p_path => 'response_format'), 'JSON'),
        p_content_type          => NVL(APEX_JSON.get_varchar2(p_path => 'content_type'), 'application/json'),
        p_requires_auth         => NVL(APEX_JSON.get_varchar2(p_path => 'requires_auth'), 'N'),
        p_auth_type             => NVL(APEX_JSON.get_varchar2(p_path => 'auth_type'), 'NONE'),
        p_auth_header_name      => APEX_JSON.get_varchar2(p_path => 'auth_header_name'),
        p_auth_value_encrypted  => APEX_JSON.get_varchar2(p_path => 'auth_value_encrypted'),
        p_timeout_seconds       => NVL(APEX_JSON.get_number(p_path => 'timeout_seconds'), 30),
        p_retry_count           => NVL(APEX_JSON.get_number(p_path => 'retry_count'), 0),
        p_cache_enabled         => NVL(APEX_JSON.get_varchar2(p_path => 'cache_enabled'), 'N'),
        p_cache_duration_seconds => APEX_JSON.get_number(p_path => 'cache_duration_seconds'),
        p_copilot_enabled       => NVL(APEX_JSON.get_varchar2(p_path => 'copilot_enabled'), 'N'),
        p_copilot_prompt        => APEX_JSON.get_varchar2(p_path => 'copilot_prompt'),
        p_copilot_parameters    => APEX_JSON.get_clob(p_path => 'copilot_parameters'),
        p_description           => APEX_JSON.get_varchar2(p_path => 'description'),
        p_notes                 => APEX_JSON.get_clob(p_path => 'notes'),
        p_tags                  => APEX_JSON.get_varchar2(p_path => 'tags'),
        p_is_active             => NVL(APEX_JSON.get_varchar2(p_path => 'is_active'), 'Y'),
        p_created_by            => NVL(APEX_JSON.get_number(p_path => 'created_by'), 1),
        p_endpoint_id           => v_endpoint_id,
        p_status                => v_status,
        p_message               => v_message
    );

    -- Set HTTP status code
    :status := CASE WHEN v_status = 'SUCCESS' THEN 201 ELSE 400 END;

    -- Build JSON response using APEX_JSON
    APEX_JSON.open_object;
    APEX_JSON.write('status', v_status);
    APEX_JSON.write('message', v_message);

    IF v_status = 'SUCCESS' THEN
        APEX_JSON.open_object('data');
        APEX_JSON.write('endpoint_id', v_endpoint_id);
        APEX_JSON.close_object;
    ELSE
        APEX_JSON.write('data', NULL);
    END IF;

    APEX_JSON.close_object;

EXCEPTION
    WHEN OTHERS THEN
        :status := 500;
        APEX_JSON.open_object;
        APEX_JSON.write('status', 'ERROR');
        APEX_JSON.write('message', SQLERRM);
        APEX_JSON.write('data', NULL);
        APEX_JSON.close_object;
END;

-- ============================================================================
-- KEY CHANGES FROM PREVIOUS VERSIONS:
-- ============================================================================
-- 1. Removed OWA_UTIL.mime_header (was causing header parsing errors)
-- 2. Removed HTP.p for JSON (was causing formatting issues)
-- 3. Using APEX_JSON.open_object/write/close_object instead
-- 4. APEX_JSON handles Content-Type headers automatically
-- 5. Cleaner, more reliable, standard APEX approach
-- ============================================================================

-- ============================================================================
-- TEST WITH POSTMAN:
-- ============================================================================
-- POST https://apex.oracle.com/pls/apex/grays/api/rr/endpoints/
--
-- Headers:
-- Content-Type: application/json
--
-- Body:
-- {
--   "module_code": "GL",
--   "feature_name": "Test Endpoint",
--   "http_method": "GET",
--   "workspace_url": "https://apex.oracle.com/pls/apex/grays/",
--   "endpoint_path": "api/test",
--   "created_by": 1
-- }
--
-- Expected Response:
-- {
--   "status": "SUCCESS",
--   "message": "Endpoint created successfully with ID: 5",
--   "data": {
--     "endpoint_id": 5
--   }
-- }
-- ============================================================================
