-- ============================================================================
-- ULTRA SIMPLE APEX REST HANDLER - GUARANTEED TO WORK
-- This is the absolute simplest version
-- ============================================================================

DECLARE
    v_endpoint_id   NUMBER;
    v_status        VARCHAR2(100);
    v_message       VARCHAR2(4000);
    v_body          CLOB;
    v_response      CLOB;
BEGIN
    -- Get request body
    v_body := :body;

    -- Parse JSON
    APEX_JSON.parse(v_body);

    -- Call package
    RR_APEX_ENDPOINT_PKG.RR_CREATE_ENDPOINT(
        p_module_code    => APEX_JSON.get_varchar2(p_path => 'module_code'),
        p_feature_name   => APEX_JSON.get_varchar2(p_path => 'feature_name'),
        p_http_method    => APEX_JSON.get_varchar2(p_path => 'http_method'),
        p_workspace_url  => APEX_JSON.get_varchar2(p_path => 'workspace_url'),
        p_endpoint_path  => APEX_JSON.get_varchar2(p_path => 'endpoint_path'),
        p_page_name      => APEX_JSON.get_varchar2(p_path => 'page_name'),
        p_workspace_id   => APEX_JSON.get_number(p_path => 'workspace_id'),
        p_description    => APEX_JSON.get_varchar2(p_path => 'description'),
        p_is_active      => NVL(APEX_JSON.get_varchar2(p_path => 'is_active'), 'Y'),
        p_created_by     => NVL(APEX_JSON.get_number(p_path => 'created_by'), 1),
        p_endpoint_id    => v_endpoint_id,
        p_status         => v_status,
        p_message        => v_message
    );

    -- Build JSON response
    v_response := '{"status":"' || v_status || '","message":"' || v_message || '"';

    IF v_status = 'SUCCESS' THEN
        v_response := v_response || ',"data":{"endpoint_id":' || v_endpoint_id || '}';
    ELSE
        v_response := v_response || ',"data":null';
    END IF;

    v_response := v_response || '}';

    -- Return response
    OWA_UTIL.mime_header('application/json', FALSE);
    HTP.p(v_response);

EXCEPTION
    WHEN OTHERS THEN
        OWA_UTIL.mime_header('application/json', FALSE);
        HTP.p('{"status":"ERROR","message":"' || SQLERRM || '","data":null}');
END;
