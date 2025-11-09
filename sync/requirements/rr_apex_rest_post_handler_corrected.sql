-- ============================================================================
-- APEX REST POST Handler - CORRECTED VERSION
-- Use this code in: APEX → SQL Workshop → RESTful Services → POST Handler
-- ============================================================================

DECLARE
    -- Input variables
    v_module_code           VARCHAR2(30);
    v_feature_name          VARCHAR2(100);
    v_page_name             VARCHAR2(100);
    v_http_method           VARCHAR2(10);
    v_workspace_id          NUMBER;
    v_workspace_url         VARCHAR2(500);
    v_endpoint_path         VARCHAR2(500);
    v_description           VARCHAR2(4000);
    v_created_by            NUMBER;

    -- Optional fields
    v_request_params        CLOB;
    v_sample_request_body   CLOB;
    v_sample_response       CLOB;
    v_response_format       VARCHAR2(20);
    v_content_type          VARCHAR2(100);
    v_requires_auth         VARCHAR2(1);
    v_auth_type             VARCHAR2(20);
    v_timeout_seconds       NUMBER;
    v_is_active             VARCHAR2(1);

    -- Output variables
    v_endpoint_id           NUMBER;
    v_status                VARCHAR2(100);
    v_message               VARCHAR2(4000);

    -- JSON parsing
    v_body                  CLOB;

BEGIN
    -- Get request body (APEX provides this automatically)
    v_body := :body;

    -- Parse required fields from JSON
    v_module_code       := apex_json.get_varchar2(p_path => 'module_code', p_values => v_body);
    v_feature_name      := apex_json.get_varchar2(p_path => 'feature_name', p_values => v_body);
    v_http_method       := apex_json.get_varchar2(p_path => 'http_method', p_values => v_body);
    v_workspace_url     := apex_json.get_varchar2(p_path => 'workspace_url', p_values => v_body);
    v_endpoint_path     := apex_json.get_varchar2(p_path => 'endpoint_path', p_values => v_body);
    v_created_by        := apex_json.get_number(p_path => 'created_by', p_values => v_body);

    -- Parse optional fields with defaults
    v_page_name         := apex_json.get_varchar2(p_path => 'page_name', p_values => v_body);
    v_workspace_id      := apex_json.get_number(p_path => 'workspace_id', p_values => v_body);
    v_description       := apex_json.get_varchar2(p_path => 'description', p_values => v_body);
    v_request_params    := apex_json.get_clob(p_path => 'request_params', p_values => v_body);
    v_sample_request_body := apex_json.get_clob(p_path => 'sample_request_body', p_values => v_body);
    v_sample_response   := apex_json.get_clob(p_path => 'sample_response', p_values => v_body);

    v_response_format   := NVL(apex_json.get_varchar2(p_path => 'response_format', p_values => v_body), 'JSON');
    v_content_type      := NVL(apex_json.get_varchar2(p_path => 'content_type', p_values => v_body), 'application/json');
    v_requires_auth     := NVL(apex_json.get_varchar2(p_path => 'requires_auth', p_values => v_body), 'N');
    v_auth_type         := NVL(apex_json.get_varchar2(p_path => 'auth_type', p_values => v_body), 'NONE');
    v_timeout_seconds   := NVL(apex_json.get_number(p_path => 'timeout_seconds', p_values => v_body), 30);
    v_is_active         := NVL(apex_json.get_varchar2(p_path => 'is_active', p_values => v_body), 'Y');

    -- Call the package procedure
    RR_APEX_ENDPOINT_PKG.RR_CREATE_ENDPOINT(
        p_module_code           => v_module_code,
        p_feature_name          => v_feature_name,
        p_http_method           => v_http_method,
        p_workspace_url         => v_workspace_url,
        p_endpoint_path         => v_endpoint_path,
        p_page_name             => v_page_name,
        p_workspace_id          => v_workspace_id,
        p_request_params        => v_request_params,
        p_sample_request_body   => v_sample_request_body,
        p_sample_response       => v_sample_response,
        p_response_format       => v_response_format,
        p_content_type          => v_content_type,
        p_requires_auth         => v_requires_auth,
        p_auth_type             => v_auth_type,
        p_timeout_seconds       => v_timeout_seconds,
        p_description           => v_description,
        p_is_active             => v_is_active,
        p_created_by            => v_created_by,
        p_endpoint_id           => v_endpoint_id,
        p_status                => v_status,
        p_message               => v_message
    );

    -- Set HTTP status code
    IF v_status = 'SUCCESS' THEN
        :status := 201;
    ELSE
        :status := 400;
    END IF;

    -- Build JSON response
    apex_json.open_object;
    apex_json.write('status', v_status);
    apex_json.write('message', v_message);

    IF v_status = 'SUCCESS' THEN
        apex_json.open_object('data');
        apex_json.write('endpoint_id', v_endpoint_id);
        apex_json.close_object;
    ELSE
        apex_json.write('data', NULL);
    END IF;

    apex_json.close_object;

EXCEPTION
    WHEN OTHERS THEN
        :status := 500;
        apex_json.open_object;
        apex_json.write('status', 'ERROR');
        apex_json.write('message', 'Internal server error: ' || SQLERRM);
        apex_json.write('data', NULL);
        apex_json.close_object;
END;
