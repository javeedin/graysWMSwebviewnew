-- ============================================================================
-- FIX: Remove OWA_UTIL.mime_header - Let APEX handle headers automatically
-- ============================================================================

-- VERSION 1: Super simple (no headers)
BEGIN
    HTP.p('{"status":"SUCCESS","message":"REST handler is working!"}');
END;


-- ============================================================================
-- VERSION 2: Using APEX_JSON (handles headers automatically)
-- ============================================================================
/*
BEGIN
    APEX_JSON.open_object;
    APEX_JSON.write('status', 'SUCCESS');
    APEX_JSON.write('message', 'REST handler is working with APEX_JSON!');
    APEX_JSON.close_object;
END;
*/


-- ============================================================================
-- VERSION 3: Test JSON parsing with APEX_JSON
-- ============================================================================
/*
DECLARE
    v_body CLOB;
    v_module_code VARCHAR2(100);
BEGIN
    v_body := :body;
    APEX_JSON.parse(v_body);
    v_module_code := APEX_JSON.get_varchar2(p_path => 'module_code');

    APEX_JSON.open_object;
    APEX_JSON.write('status', 'SUCCESS');
    APEX_JSON.write('module_code', v_module_code);
    APEX_JSON.close_object;
END;
*/


-- ============================================================================
-- VERSION 4: Complete handler with APEX_JSON
-- ============================================================================
/*
DECLARE
    v_endpoint_id   NUMBER;
    v_status        VARCHAR2(100);
    v_message       VARCHAR2(4000);
    v_body          CLOB;
BEGIN
    v_body := :body;
    APEX_JSON.parse(v_body);

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
        APEX_JSON.write('data', NULL);
        APEX_JSON.close_object;
END;
*/


-- ============================================================================
-- INSTRUCTIONS:
-- ============================================================================
-- 1. Start with VERSION 1 (the uncommented one at top)
-- 2. If VERSION 1 works, try VERSION 2 (uncomment it)
-- 3. If VERSION 2 works, try VERSION 3
-- 4. If VERSION 3 works, use VERSION 4 (the complete one)
--
-- The key fix: Removed OWA_UTIL.mime_header which was causing header issues
-- Using HTP.p or APEX_JSON which handle headers automatically
-- ============================================================================
