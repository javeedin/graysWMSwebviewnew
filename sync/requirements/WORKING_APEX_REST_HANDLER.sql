-- ============================================================================
-- WORKING APEX REST HANDLER - POST Method
-- This version PARSES the JSON body first, then extracts values
-- ============================================================================

DECLARE
    v_endpoint_id   NUMBER;
    v_status        VARCHAR2(100);
    v_message       VARCHAR2(4000);
    v_body          CLOB;
BEGIN
    -- Get the request body
    v_body := :body;

    -- IMPORTANT: Parse the JSON body first!
    APEX_JSON.parse(v_body);

    -- Now extract values from the parsed JSON
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

    -- Return JSON response
    HTP.p('{');
    HTP.p('"status":"' || v_status || '",');
    HTP.p('"message":"' || REPLACE(v_message, '"', '\"') || '",');
    IF v_status = 'SUCCESS' THEN
        HTP.p('"data":{"endpoint_id":' || v_endpoint_id || '}');
    ELSE
        HTP.p('"data":null');
    END IF;
    HTP.p('}');

EXCEPTION
    WHEN OTHERS THEN
        :status := 500;
        HTP.p('{');
        HTP.p('"status":"ERROR",');
        HTP.p('"message":"' || REPLACE(SQLERRM, '"', '\"') || '",');
        HTP.p('"data":null');
        HTP.p('}');
END;

-- ============================================================================
-- THE KEY FIX:
-- Added these two lines at the beginning:
--   v_body := :body;
--   APEX_JSON.parse(v_body);
--
-- This parses the incoming JSON so that APEX_JSON.get_varchar2() can work!
-- ============================================================================

-- ============================================================================
-- TEST WITH YOUR JSON:
-- ============================================================================
/*
POST Request to: https://apex.oracle.com/pls/apex/grays/api/rr/endpoints/

Headers:
Content-Type: application/json

Body:
{
  "module_code": "GL",
  "feature_name": "Test Endpoint",
  "http_method": "GET",
  "workspace_url": "https://apex.oracle.com/pls/apex/grays/",
  "endpoint_path": "api/test",
  "created_by": 1
}

Expected Response:
{
  "status": "SUCCESS",
  "message": "Endpoint created successfully with ID: 4",
  "data": {
    "endpoint_id": 4
  }
}
*/
