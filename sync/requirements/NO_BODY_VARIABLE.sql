-- ============================================================================
-- VERSION WITHOUT :body BIND VARIABLE
-- Uses APEX's automatic JSON parsing from request
-- ============================================================================

DECLARE
    v_endpoint_id   NUMBER;
    v_status        VARCHAR2(100);
    v_message       VARCHAR2(4000);
BEGIN
    -- APEX automatically parses JSON when Content-Type is application/json
    -- No need to manually get :body or call APEX_JSON.parse
    -- Just directly use APEX_JSON.get_* functions

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
        APEX_JSON.open_object;
        APEX_JSON.write('status', 'ERROR');
        APEX_JSON.write('message', SQLERRM);
        APEX_JSON.close_object;
END;

-- ============================================================================
-- KEY DIFFERENCE:
-- - NO :body variable
-- - NO APEX_JSON.parse() call
-- - APEX automatically parses JSON from request body when Content-Type header
--   is set to application/json
-- ============================================================================
