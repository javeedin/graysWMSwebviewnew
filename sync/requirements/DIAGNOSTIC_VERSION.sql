-- ============================================================================
-- DIAGNOSTIC VERSION - Shows exactly what's happening with :body
-- Use this to see the actual error
-- ============================================================================

DECLARE
    v_body CLOB;
    v_module_code VARCHAR2(100);
    v_error VARCHAR2(4000);
BEGIN
    -- Try to get body
    BEGIN
        v_body := :body;
    EXCEPTION
        WHEN OTHERS THEN
            v_error := 'Error getting :body - ' || SQLERRM;
    END;

    -- Output diagnostic info
    APEX_JSON.open_object;
    APEX_JSON.write('status', 'DIAGNOSTIC');

    IF v_error IS NOT NULL THEN
        APEX_JSON.write('error', v_error);
    ELSE
        APEX_JSON.write('body_length', DBMS_LOB.GETLENGTH(v_body));
        APEX_JSON.write('body_content', SUBSTR(v_body, 1, 200)); -- First 200 chars

        -- Try to parse
        BEGIN
            APEX_JSON.parse(v_body);
            v_module_code := APEX_JSON.get_varchar2(p_path => 'module_code');
            APEX_JSON.write('parse_status', 'SUCCESS');
            APEX_JSON.write('module_code', v_module_code);
        EXCEPTION
            WHEN OTHERS THEN
                APEX_JSON.write('parse_error', SQLERRM);
        END;
    END IF;

    APEX_JSON.close_object;

EXCEPTION
    WHEN OTHERS THEN
        APEX_JSON.open_object;
        APEX_JSON.write('status', 'FATAL_ERROR');
        APEX_JSON.write('error', SQLERRM);
        APEX_JSON.close_object;
END;

-- ============================================================================
-- This will show you:
-- - If :body is accessible
-- - What's in :body
-- - If JSON parsing works
-- - What the actual error is
-- ============================================================================
