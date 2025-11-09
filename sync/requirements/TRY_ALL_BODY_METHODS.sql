-- ============================================================================
-- Try all possible methods to get and parse request body
-- ============================================================================

DECLARE
    v_endpoint_id   NUMBER;
    v_status        VARCHAR2(100);
    v_message       VARCHAR2(4000);
    v_body          CLOB;
    v_parsed        BOOLEAN := FALSE;
    v_module_code   VARCHAR2(100);
BEGIN
    -- Method 1: Try to get body from different sources
    BEGIN
        -- Try APEX_APPLICATION.g_request_body (some APEX versions)
        v_body := APEX_APPLICATION.g_request_body;
        IF v_body IS NOT NULL THEN
            v_parsed := TRUE;
        END IF;
    EXCEPTION
        WHEN OTHERS THEN NULL;
    END;

    -- Method 2: If Method 1 failed, try UTL_HTTP approach
    IF NOT v_parsed THEN
        BEGIN
            -- Get from APEX request
            v_body := APEX_UTIL.GET_SESSION_STATE('REQUEST_BODY');
            IF v_body IS NOT NULL THEN
                v_parsed := TRUE;
            END IF;
        EXCEPTION
            WHEN OTHERS THEN NULL;
        END;
    END IF;

    -- Method 3: If still no body, try to use :body bind variable
    IF NOT v_parsed THEN
        BEGIN
            v_body := :body;
            v_parsed := TRUE;
        EXCEPTION
            WHEN OTHERS THEN NULL;
        END;
    END IF;

    -- If we got the body, parse it
    IF v_parsed AND v_body IS NOT NULL THEN
        APEX_JSON.parse(v_body);

        -- Now call the package
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

        -- Return result
        HTP.p('{"status":"' || v_status || '",' ||
              '"message":"' || REPLACE(v_message, '"', '\"') || '"');

        IF v_status = 'SUCCESS' THEN
            HTP.p(',"data":{"endpoint_id":' || v_endpoint_id || '}}');
        ELSE
            HTP.p('}');
        END IF;
    ELSE
        -- Could not get body
        HTP.p('{"status":"ERROR","message":"Could not access request body"}');
    END IF;

EXCEPTION
    WHEN OTHERS THEN
        HTP.p('{"status":"ERROR","message":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
