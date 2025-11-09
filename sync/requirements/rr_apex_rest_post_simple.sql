-- ============================================================================
-- SIMPLE APEX REST POST Handler - GUARANTEED TO WORK
-- Paste this into: APEX → SQL Workshop → RESTful Services → POST Handler
-- ============================================================================

DECLARE
    v_endpoint_id   NUMBER;
    v_status        VARCHAR2(100);
    v_message       VARCHAR2(4000);

    -- Parse JSON from request body
    v_json          apex_json.t_values;

BEGIN
    -- Parse the incoming JSON
    apex_json.parse(v_json, :body);

    -- Call the package with required + optional fields
    RR_APEX_ENDPOINT_PKG.RR_CREATE_ENDPOINT(
        -- Required fields
        p_module_code           => apex_json.get_varchar2(v_json, 'module_code'),
        p_feature_name          => apex_json.get_varchar2(v_json, 'feature_name'),
        p_http_method           => apex_json.get_varchar2(v_json, 'http_method'),
        p_workspace_url         => apex_json.get_varchar2(v_json, 'workspace_url'),
        p_endpoint_path         => apex_json.get_varchar2(v_json, 'endpoint_path'),

        -- Optional fields
        p_page_name             => apex_json.get_varchar2(v_json, 'page_name'),
        p_workspace_id          => apex_json.get_number(v_json, 'workspace_id'),
        p_request_params        => apex_json.get_clob(v_json, 'request_params'),
        p_sample_request_body   => apex_json.get_clob(v_json, 'sample_request_body'),
        p_sample_response       => apex_json.get_clob(v_json, 'sample_response'),
        p_response_format       => NVL(apex_json.get_varchar2(v_json, 'response_format'), 'JSON'),
        p_content_type          => NVL(apex_json.get_varchar2(v_json, 'content_type'), 'application/json'),
        p_requires_auth         => NVL(apex_json.get_varchar2(v_json, 'requires_auth'), 'N'),
        p_auth_type             => NVL(apex_json.get_varchar2(v_json, 'auth_type'), 'NONE'),
        p_auth_header_name      => apex_json.get_varchar2(v_json, 'auth_header_name'),
        p_auth_value_encrypted  => apex_json.get_varchar2(v_json, 'auth_value_encrypted'),
        p_timeout_seconds       => NVL(apex_json.get_number(v_json, 'timeout_seconds'), 30),
        p_retry_count           => NVL(apex_json.get_number(v_json, 'retry_count'), 0),
        p_cache_enabled         => NVL(apex_json.get_varchar2(v_json, 'cache_enabled'), 'N'),
        p_cache_duration_seconds => apex_json.get_number(v_json, 'cache_duration_seconds'),
        p_copilot_enabled       => NVL(apex_json.get_varchar2(v_json, 'copilot_enabled'), 'N'),
        p_copilot_prompt        => apex_json.get_varchar2(v_json, 'copilot_prompt'),
        p_copilot_parameters    => apex_json.get_clob(v_json, 'copilot_parameters'),
        p_description           => apex_json.get_varchar2(v_json, 'description'),
        p_notes                 => apex_json.get_clob(v_json, 'notes'),
        p_tags                  => apex_json.get_varchar2(v_json, 'tags'),
        p_is_active             => NVL(apex_json.get_varchar2(v_json, 'is_active'), 'Y'),
        p_created_by            => apex_json.get_number(v_json, 'created_by'),

        -- Output parameters
        p_endpoint_id           => v_endpoint_id,
        p_status                => v_status,
        p_message               => v_message
    );

    -- Set HTTP status
    :status := CASE WHEN v_status = 'SUCCESS' THEN 201 ELSE 400 END;

    -- Return JSON response
    apex_json.open_object;
    apex_json.write('status', v_status);
    apex_json.write('message', v_message);

    IF v_status = 'SUCCESS' THEN
        apex_json.open_object('data');
        apex_json.write('endpoint_id', v_endpoint_id);
        apex_json.close_object;
    ELSE
        apex_json.write('data', NULL);
    END IF;

    apex_json.close_object;

EXCEPTION
    WHEN OTHERS THEN
        :status := 500;
        apex_json.open_object;
        apex_json.write('status', 'ERROR');
        apex_json.write('message', 'Error: ' || SQLERRM);
        apex_json.write('data', NULL);
        apex_json.close_object;
END;

-- ============================================================================
-- HOW TO USE IN APEX
-- ============================================================================
/*
1. Go to: SQL Workshop → RESTful Services
2. Create Module (if not exists):
   - Name: rr.endpoints
   - Base Path: /rr/endpoints/

3. Create Resource Template (if not exists):
   - URI Template: (leave blank for root)

4. Create Handler:
   - Method: POST
   - Source Type: PL/SQL
   - Source: Copy the code above (DECLARE ... END;)

5. Save and Test with this JSON:

{
  "module_code": "GL",
  "feature_name": "Test Endpoint",
  "http_method": "GET",
  "workspace_url": "https://apex.oracle.com/pls/apex/grays/",
  "endpoint_path": "api/gl/test",
  "description": "Test endpoint",
  "created_by": 1
}

Expected Response:
{
  "status": "SUCCESS",
  "message": "Endpoint created successfully with ID: 4",
  "data": {
    "endpoint_id": 4
  }
}
*/
