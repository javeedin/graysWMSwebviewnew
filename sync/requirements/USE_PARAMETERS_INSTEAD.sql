-- ============================================================================
-- ALTERNATIVE APPROACH: Use parameters instead of JSON body
-- ============================================================================
-- This approach uses query parameters or form parameters
-- Instead of parsing JSON from body
-- ============================================================================

DECLARE
    v_endpoint_id   NUMBER;
    v_status        VARCHAR2(100);
    v_message       VARCHAR2(4000);
BEGIN
    -- Use parameters directly (no JSON parsing needed)
    RR_APEX_ENDPOINT_PKG.RR_CREATE_ENDPOINT(
        p_module_code    => :module_code,
        p_feature_name   => :feature_name,
        p_http_method    => :http_method,
        p_workspace_url  => :workspace_url,
        p_endpoint_path  => :endpoint_path,
        p_page_name      => :page_name,
        p_workspace_id   => :workspace_id,
        p_description    => :description,
        p_is_active      => NVL(:is_active, 'Y'),
        p_created_by     => NVL(:created_by, 1),
        p_endpoint_id    => v_endpoint_id,
        p_status         => v_status,
        p_message        => v_message
    );

    :status := CASE WHEN v_status = 'SUCCESS' THEN 201 ELSE 400 END;

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
        :status := 500;
        APEX_JSON.open_object;
        APEX_JSON.write('status', 'ERROR');
        APEX_JSON.write('message', SQLERRM);
        APEX_JSON.close_object;
END;

-- ============================================================================
-- IMPORTANT: For this to work, you need to define parameters in APEX
-- ============================================================================
-- In your POST handler settings in APEX:
-- 1. Go to Handler → Parameters
-- 2. Add parameters:
--    - module_code (Source: Request Body)
--    - feature_name (Source: Request Body)
--    - http_method (Source: Request Body)
--    - workspace_url (Source: Request Body)
--    - endpoint_path (Source: Request Body)
--    - etc.
--
-- OR use this simpler approach without defining parameters...
-- ============================================================================
