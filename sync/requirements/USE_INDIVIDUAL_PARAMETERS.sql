-- ============================================================================
-- SOLUTION: Use individual parameters (no :body, no JSON parsing)
-- ============================================================================
-- IMPORTANT: You must configure these parameters in APEX Handler settings
-- For EACH parameter below, add it in the Parameters section:
--   - Source Type: Request Body
--   - Data Type: STRING (or INT for numbers)
-- ============================================================================

DECLARE
    v_endpoint_id   NUMBER;
    v_status        VARCHAR2(100);
    v_message       VARCHAR2(4000);
BEGIN
    -- Use parameters directly - APEX extracts them from JSON automatically
    RR_APEX_ENDPOINT_PKG.RR_CREATE_ENDPOINT(
        p_module_code    => :module_code,
        p_feature_name   => :feature_name,
        p_http_method    => :http_method,
        p_workspace_url  => :workspace_url,
        p_endpoint_path  => :endpoint_path,
        p_page_name      => :page_name,
        p_workspace_id   => TO_NUMBER(:workspace_id),
        p_description    => :description,
        p_is_active      => NVL(:is_active, 'Y'),
        p_created_by     => NVL(TO_NUMBER(:created_by), 1),
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

EXCEPTION
    WHEN OTHERS THEN
        HTP.p('{"status":"ERROR","message":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;

-- ============================================================================
-- SETUP INSTRUCTIONS:
-- ============================================================================
-- 1. In APEX, go to your POST handler
-- 2. Scroll to "Parameters" section
-- 3. For EACH bind variable above (:module_code, :feature_name, etc.),
--    click "Create Parameter" and add:
--
--    Parameter: module_code
--      - Bind Variable: module_code
--      - Source Type: Request Body
--      - Access Method: IN
--      - Data Type: STRING
--
--    Parameter: feature_name
--      - Bind Variable: feature_name
--      - Source Type: Request Body
--      - Access Method: IN
--      - Data Type: STRING
--
--    Parameter: http_method
--      - Bind Variable: http_method
--      - Source Type: Request Body
--      - Access Method: IN
--      - Data Type: STRING
--
--    (Continue for all fields...)
--
-- 4. Save handler
-- 5. Test - APEX will automatically extract JSON fields into variables
-- ============================================================================

-- ============================================================================
-- ALTERNATIVE: If parameters don't work, use this minimal version
-- ============================================================================
/*
BEGIN
    HTP.p('{"status":"TEST","message":"Handler is accessible"}');
END;
*/
