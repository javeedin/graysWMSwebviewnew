-- ============================================================================
-- MINIMAL TEST HANDLER - Test if APEX REST is working at all
-- Use this FIRST to verify your REST setup is correct
-- ============================================================================

-- VERSION 1: Super simple test (no package call)
BEGIN
    OWA_UTIL.mime_header('application/json', FALSE);
    HTP.p('{"status":"SUCCESS","message":"REST handler is working!"}');
END;

-- ============================================================================
-- If VERSION 1 works, try VERSION 2: Parse JSON
-- ============================================================================
/*
DECLARE
    v_body CLOB;
    v_module_code VARCHAR2(100);
BEGIN
    v_body := :body;
    APEX_JSON.parse(v_body);
    v_module_code := APEX_JSON.get_varchar2(p_path => 'module_code');

    OWA_UTIL.mime_header('application/json', FALSE);
    HTP.p('{"status":"SUCCESS","module_code":"' || v_module_code || '"}');
END;
*/

-- ============================================================================
-- If VERSION 2 works, try VERSION 3: Call package with hardcoded values
-- ============================================================================
/*
DECLARE
    v_endpoint_id   NUMBER;
    v_status        VARCHAR2(100);
    v_message       VARCHAR2(4000);
BEGIN
    RR_APEX_ENDPOINT_PKG.RR_CREATE_ENDPOINT(
        p_module_code    => 'GL',
        p_feature_name   => 'Hardcoded Test',
        p_http_method    => 'GET',
        p_workspace_url  => 'https://apex.oracle.com/pls/apex/grays/',
        p_endpoint_path  => 'api/test',
        p_created_by     => 1,
        p_endpoint_id    => v_endpoint_id,
        p_status         => v_status,
        p_message        => v_message
    );

    OWA_UTIL.mime_header('application/json', FALSE);
    HTP.p('{"status":"' || v_status || '","endpoint_id":' || v_endpoint_id || '}');
END;
*/

-- ============================================================================
-- INSTRUCTIONS:
-- ============================================================================
/*
1. Create a new POST handler in APEX REST
2. Paste VERSION 1 (the simple one at the top)
3. Test with Postman - any JSON body is fine
4. If it works, you'll see: {"status":"SUCCESS","message":"REST handler is working!"}
5. If VERSION 1 works, try VERSION 2 (uncomment it, comment VERSION 1)
6. If VERSION 2 works, try VERSION 3
7. If VERSION 3 works, try the ULTRA_SIMPLE_APEX_HANDLER.sql

This will help identify exactly where the problem is.
*/
