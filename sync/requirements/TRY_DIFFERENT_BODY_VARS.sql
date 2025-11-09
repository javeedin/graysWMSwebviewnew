-- ============================================================================
-- Try different body variable names
-- Different APEX versions use different bind variables
-- ============================================================================

DECLARE
    v_body CLOB;
    v_method VARCHAR2(100);
    v_module_code VARCHAR2(100);
BEGIN
    -- Try multiple ways to get the body
    BEGIN
        -- Method 1: :body
        v_body := :body;
        v_method := 'Method 1: :body';
    EXCEPTION
        WHEN OTHERS THEN
            BEGIN
                -- Method 2: :body_text
                v_body := :body_text;
                v_method := 'Method 2: :body_text';
            EXCEPTION
                WHEN OTHERS THEN
                    BEGIN
                        -- Method 3: APEX_UTIL
                        v_body := APEX_UTIL.GET_BLOB_FILE_SRC('body');
                        v_method := 'Method 3: APEX_UTIL';
                    EXCEPTION
                        WHEN OTHERS THEN
                            v_method := 'ALL METHODS FAILED';
                    END;
            END;
    END;

    -- Parse and extract
    IF v_body IS NOT NULL THEN
        APEX_JSON.parse(v_body);
        v_module_code := APEX_JSON.get_varchar2(p_path => 'module_code');
    END IF;

    -- Output result
    APEX_JSON.open_object;
    APEX_JSON.write('status', 'SUCCESS');
    APEX_JSON.write('method_used', v_method);
    APEX_JSON.write('body_length', DBMS_LOB.GETLENGTH(v_body));
    APEX_JSON.write('module_code', v_module_code);
    APEX_JSON.close_object;

EXCEPTION
    WHEN OTHERS THEN
        APEX_JSON.open_object;
        APEX_JSON.write('status', 'ERROR');
        APEX_JSON.write('error', SQLERRM);
        APEX_JSON.write('method_attempted', v_method);
        APEX_JSON.close_object;
END;
