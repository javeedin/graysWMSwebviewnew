-- ============================================================================
-- SIMPLEST POSSIBLE HANDLER
-- Test this FIRST to see if we can receive ANY data
-- ============================================================================

BEGIN
    -- Just echo back that we received a POST
    HTP.p('{"status":"SUCCESS","message":"POST received successfully","note":"If you see this, handler works!"}');
END;

-- ============================================================================
-- If the above works, try VERSION 2:
-- ============================================================================
/*
BEGIN
    -- Try to echo back what we received
    DECLARE
        v_body VARCHAR2(32767);
    BEGIN
        -- Try different ways to get content
        v_body := SUBSTR(OWA_UTIL.GET_CGI_ENV('REQUEST_BODY'), 1, 200);

        IF v_body IS NULL THEN
            v_body := 'Body was NULL';
        END IF;

        HTP.p('{"status":"SUCCESS","body_preview":"' || v_body || '"}');
    EXCEPTION
        WHEN OTHERS THEN
            HTP.p('{"status":"ERROR","message":"' || SQLERRM || '"}');
    END;
END;
*/

-- ============================================================================
-- If VERSION 2 works, try VERSION 3 with hardcoded test:
-- ============================================================================
/*
DECLARE
    v_endpoint_id   NUMBER;
    v_status        VARCHAR2(100);
    v_message       VARCHAR2(4000);
BEGIN
    -- Call package with HARDCODED values (no parameters, no JSON parsing)
    RR_APEX_ENDPOINT_PKG.RR_CREATE_ENDPOINT(
        p_module_code    => 'GL',
        p_feature_name   => 'Hardcoded Test from REST',
        p_http_method    => 'GET',
        p_workspace_url  => 'https://apex.oracle.com/pls/apex/grays/',
        p_endpoint_path  => 'api/hardcoded/test',
        p_description    => 'Testing with hardcoded values',
        p_created_by     => 1,
        p_endpoint_id    => v_endpoint_id,
        p_status         => v_status,
        p_message        => v_message
    );

    HTP.p('{"status":"' || v_status || '","message":"' || v_message || '","endpoint_id":' || NVL(TO_CHAR(v_endpoint_id), 'null') || '}');
END;
*/

-- ============================================================================
-- TESTING INSTRUCTIONS:
-- ============================================================================
-- 1. Start with the first BEGIN/END block (SIMPLEST)
-- 2. Test in Postman - you should get: {"status":"SUCCESS",...}
-- 3. If that works, uncomment VERSION 2 and test
-- 4. If VERSION 2 works, uncomment VERSION 3 and test
-- 5. Each step narrows down where the problem is
-- ============================================================================
