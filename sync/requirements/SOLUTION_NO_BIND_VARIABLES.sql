-- ============================================================================
-- SOLUTION: No bind variables at all - Use OWA to read request body
-- ============================================================================

DECLARE
    v_endpoint_id   NUMBER;
    v_status        VARCHAR2(100);
    v_message       VARCHAR2(4000);
    v_body          CLOB;
    v_body_raw      RAW(32767);
    v_body_varchar  VARCHAR2(32767);
BEGIN
    -- Read request body using OWA (works in all APEX versions)
    FOR i IN 1..OWA.NUM_CGI_VARS LOOP
        IF OWA.CGI_VAR_NAME(i) = 'wsgi.input' THEN
            v_body_raw := OWA.CGI_VAR_VAL(i);
            EXIT;
        END IF;
    END LOOP;

    -- If OWA method didn't work, try reading from request
    IF v_body_raw IS NULL THEN
        -- Try to read the body as VARCHAR2
        v_body_varchar := OWA_UTIL.GET_CGI_ENV('REQUEST_BODY');
        IF v_body_varchar IS NOT NULL THEN
            v_body := v_body_varchar;
        END IF;
    ELSE
        v_body := UTL_RAW.CAST_TO_VARCHAR2(v_body_raw);
    END IF;

    -- If we still don't have body, try another method
    IF v_body IS NULL OR LENGTH(v_body) = 0 THEN
        -- Get the raw request
        v_body := OWA_UTIL.GET_CGI_ENV('wsgi.input');
    END IF;

    -- Parse JSON
    IF v_body IS NOT NULL THEN
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

        HTP.p('{"status":"' || v_status || '",' ||
              '"message":"' || REPLACE(v_message, '"', '\"') || '"');

        IF v_status = 'SUCCESS' THEN
            HTP.p(',"data":{"endpoint_id":' || v_endpoint_id || '}}');
        ELSE
            HTP.p('}');
        END IF;
    ELSE
        HTP.p('{"status":"ERROR","message":"Could not read request body"}');
    END IF;

EXCEPTION
    WHEN OTHERS THEN
        HTP.p('{"status":"ERROR","message":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;

-- ============================================================================
-- This version:
-- 1. NO :body bind variable
-- 2. Uses OWA package to read request
-- 3. Should work in most APEX versions
-- ============================================================================
