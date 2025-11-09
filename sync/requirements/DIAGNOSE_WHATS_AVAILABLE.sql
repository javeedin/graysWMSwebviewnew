-- ============================================================================
-- DIAGNOSTIC - Show what's available in the request
-- This will tell us how to access the request body
-- ============================================================================

DECLARE
    v_body_clob CLOB;
    v_body_blob BLOB;
    v_body_varchar VARCHAR2(32767);
    v_result VARCHAR2(4000) := '';
BEGIN
    -- Try different ways to get the body

    -- Method 1: Try :body
    BEGIN
        v_body_clob := :body;
        v_result := v_result || 'Method1:body_works|';
    EXCEPTION
        WHEN OTHERS THEN
            v_result := v_result || 'Method1:body_fails|';
    END;

    -- Method 2: Try :body_text
    BEGIN
        v_body_clob := :body_text;
        v_result := v_result || 'Method2:body_text_works|';
    EXCEPTION
        WHEN OTHERS THEN
            v_result := v_result || 'Method2:body_text_fails|';
    END;

    -- Method 3: Try APEX_UTIL.GET_BLOB_FILE_SRC
    BEGIN
        v_body_blob := APEX_UTIL.GET_BLOB_FILE_SRC('REQUEST_BODY');
        v_result := v_result || 'Method3:blob_works|';
    EXCEPTION
        WHEN OTHERS THEN
            v_result := v_result || 'Method3:blob_fails|';
    END;

    -- Method 4: Check if APEX already parsed JSON
    BEGIN
        APEX_JSON.initialize_clob_output;
        APEX_JSON.open_object;
        APEX_JSON.write('test_get_varchar2', APEX_JSON.get_varchar2(p_path => 'module_code'));
        APEX_JSON.write('diagnostic_result', v_result);
        APEX_JSON.close_object;
        v_body_clob := APEX_JSON.get_clob_output;
        APEX_JSON.free_output;
    EXCEPTION
        WHEN OTHERS THEN
            v_body_clob := '{"error":"' || SQLERRM || '"}';
    END;

    HTP.p(v_body_clob);

EXCEPTION
    WHEN OTHERS THEN
        HTP.p('{"fatal_error":"' || SQLERRM || '"}');
END;

-- ============================================================================
-- Test this handler with your JSON payload
-- It will tell you which method works to access the body
-- ============================================================================
