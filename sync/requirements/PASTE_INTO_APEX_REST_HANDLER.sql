-- ============================================================================
-- APEX REST HANDLER - POST Method
-- ============================================================================
-- WHERE TO USE THIS:
-- 1. Go to APEX
-- 2. SQL Workshop → RESTful Services
-- 3. Create Module: rr.endpoints, Base Path: /rr/endpoints/
-- 4. Create Handler: Method = POST
-- 5. PASTE ONLY THE CODE BETWEEN THE LINES BELOW (from DECLARE to END;)
-- ============================================================================

DECLARE
    v_endpoint_id   NUMBER;
    v_status        VARCHAR2(100);
    v_message       VARCHAR2(4000);
BEGIN
    -- Parse incoming JSON (APEX does this automatically when you send JSON in body)
    RR_APEX_ENDPOINT_PKG.RR_CREATE_ENDPOINT(
        p_module_code           => APEX_JSON.get_varchar2(p_path => 'module_code'),
        p_feature_name          => APEX_JSON.get_varchar2(p_path => 'feature_name'),
        p_http_method           => APEX_JSON.get_varchar2(p_path => 'http_method'),
        p_workspace_url         => APEX_JSON.get_varchar2(p_path => 'workspace_url'),
        p_endpoint_path         => APEX_JSON.get_varchar2(p_path => 'endpoint_path'),
        p_page_name             => APEX_JSON.get_varchar2(p_path => 'page_name'),
        p_workspace_id          => APEX_JSON.get_number(p_path => 'workspace_id'),
        p_description           => APEX_JSON.get_varchar2(p_path => 'description'),
        p_requires_auth         => NVL(APEX_JSON.get_varchar2(p_path => 'requires_auth'), 'N'),
        p_auth_type             => NVL(APEX_JSON.get_varchar2(p_path => 'auth_type'), 'NONE'),
        p_timeout_seconds       => NVL(APEX_JSON.get_number(p_path => 'timeout_seconds'), 30),
        p_is_active             => NVL(APEX_JSON.get_varchar2(p_path => 'is_active'), 'Y'),
        p_created_by            => NVL(APEX_JSON.get_number(p_path => 'created_by'), 1),
        p_endpoint_id           => v_endpoint_id,
        p_status                => v_status,
        p_message               => v_message
    );

    -- Set HTTP status code
    :status := CASE WHEN v_status = 'SUCCESS' THEN 201 ELSE 400 END;

    -- Return JSON response
    HTP.p('{');
    HTP.p('"status":"' || v_status || '",');
    HTP.p('"message":"' || REPLACE(v_message, '"', '\"') || '",');
    IF v_status = 'SUCCESS' THEN
        HTP.p('"data":{"endpoint_id":' || v_endpoint_id || '}');
    ELSE
        HTP.p('"data":null');
    END IF;
    HTP.p('}');

EXCEPTION
    WHEN OTHERS THEN
        :status := 500;
        HTP.p('{');
        HTP.p('"status":"ERROR",');
        HTP.p('"message":"' || REPLACE(SQLERRM, '"', '\"') || '",');
        HTP.p('"data":null');
        HTP.p('}');
END;

-- ============================================================================
-- AFTER CREATING THE REST HANDLER, TEST WITH:
-- ============================================================================
-- Postman:
--   POST https://apex.oracle.com/pls/apex/grays/api/rr/endpoints/
--   Headers: Content-Type: application/json
--   Body: {"module_code":"GL","feature_name":"Test","http_method":"GET","workspace_url":"https://apex.oracle.com/pls/apex/grays/","endpoint_path":"api/test","created_by":1}
--
-- cURL:
--   curl -X POST "https://apex.oracle.com/pls/apex/grays/api/rr/endpoints/" \
--     -H "Content-Type: application/json" \
--     -d '{"module_code":"GL","feature_name":"Test","http_method":"GET","workspace_url":"https://apex.oracle.com/pls/apex/grays/","endpoint_path":"api/test","created_by":1}'
-- ============================================================================
