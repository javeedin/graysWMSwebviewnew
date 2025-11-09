-- ============================================================================
-- COMPLETE WORKING POST HANDLER - All Columns
-- ============================================================================

DECLARE
    v_endpoint_id   NUMBER;
    v_status        VARCHAR2(100);
    v_message       VARCHAR2(4000);
BEGIN
    RR_APEX_ENDPOINT_PKG.RR_CREATE_ENDPOINT(
        -- Required fields
        p_module_code           => :module_code,
        p_feature_name          => :feature_name,
        p_http_method           => :http_method,
        p_workspace_url         => :workspace_url,
        p_endpoint_path         => :endpoint_path,

        -- Optional basic fields
        p_page_name             => :page_name,
        p_workspace_id          => TO_NUMBER(:workspace_id),
        p_description           => :description,
        p_notes                 => :notes,
        p_tags                  => :tags,

        -- Request/Response fields
        p_request_params        => :request_params,
        p_sample_request_body   => :sample_request_body,
        p_sample_response       => :sample_response,
        p_response_format       => NVL(:response_format, 'JSON'),
        p_content_type          => NVL(:content_type, 'application/json'),

        -- Authentication fields
        p_requires_auth         => NVL(:requires_auth, 'N'),
        p_auth_type             => NVL(:auth_type, 'NONE'),
        p_auth_header_name      => :auth_header_name,
        p_auth_value_encrypted  => :auth_value_encrypted,

        -- Performance fields
        p_timeout_seconds       => NVL(TO_NUMBER(:timeout_seconds), 30),
        p_retry_count           => NVL(TO_NUMBER(:retry_count), 0),
        p_cache_enabled         => NVL(:cache_enabled, 'N'),
        p_cache_duration_seconds => TO_NUMBER(:cache_duration_seconds),

        -- Co-Pilot fields
        p_copilot_enabled       => NVL(:copilot_enabled, 'N'),
        p_copilot_prompt        => :copilot_prompt,
        p_copilot_parameters    => :copilot_parameters,

        -- Status and audit fields
        p_is_active             => NVL(:is_active, 'Y'),
        p_created_by            => NVL(TO_NUMBER(:created_by), 1),

        -- Output parameters
        p_endpoint_id           => v_endpoint_id,
        p_status                => v_status,
        p_message               => v_message
    );

    -- Build JSON response
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
-- APEX PARAMETERS CONFIGURATION
-- ============================================================================
-- You need to add these parameters in APEX Handler UI:
-- Go to: SQL Workshop → RESTful Services → Your Module → POST Handler → Parameters
--
-- For EACH parameter below, click "Create Parameter" and configure:
--
-- 1. module_code
--    - Bind Variable: module_code
--    - Source Type: Request Body
--    - Access Method: IN
--    - Data Type: STRING
--    - Required: Yes
--
-- 2. feature_name
--    - Bind Variable: feature_name
--    - Source Type: Request Body
--    - Access Method: IN
--    - Data Type: STRING
--    - Required: Yes
--
-- 3. http_method
--    - Bind Variable: http_method
--    - Source Type: Request Body
--    - Access Method: IN
--    - Data Type: STRING
--    - Required: Yes
--
-- 4. workspace_url
--    - Bind Variable: workspace_url
--    - Source Type: Request Body
--    - Access Method: IN
--    - Data Type: STRING
--    - Required: Yes
--
-- 5. endpoint_path
--    - Bind Variable: endpoint_path
--    - Source Type: Request Body
--    - Access Method: IN
--    - Data Type: STRING
--    - Required: Yes
--
-- 6. page_name
--    - Bind Variable: page_name
--    - Source Type: Request Body
--    - Access Method: IN
--    - Data Type: STRING
--    - Required: No
--
-- 7. workspace_id
--    - Bind Variable: workspace_id
--    - Source Type: Request Body
--    - Access Method: IN
--    - Data Type: STRING (will convert to NUMBER in code)
--    - Required: No
--
-- 8. description
--    - Bind Variable: description
--    - Source Type: Request Body
--    - Access Method: IN
--    - Data Type: STRING
--    - Required: No
--
-- 9. notes
--    - Bind Variable: notes
--    - Source Type: Request Body
--    - Access Method: IN
--    - Data Type: STRING
--    - Required: No
--
-- 10. tags
--    - Bind Variable: tags
--    - Source Type: Request Body
--    - Access Method: IN
--    - Data Type: STRING
--    - Required: No
--
-- 11. request_params
--    - Bind Variable: request_params
--    - Source Type: Request Body
--    - Access Method: IN
--    - Data Type: STRING
--    - Required: No
--
-- 12. sample_request_body
--    - Bind Variable: sample_request_body
--    - Source Type: Request Body
--    - Access Method: IN
--    - Data Type: STRING
--    - Required: No
--
-- 13. sample_response
--    - Bind Variable: sample_response
--    - Source Type: Request Body
--    - Access Method: IN
--    - Data Type: STRING
--    - Required: No
--
-- 14. response_format
--    - Bind Variable: response_format
--    - Source Type: Request Body
--    - Access Method: IN
--    - Data Type: STRING
--    - Required: No
--
-- 15. content_type
--    - Bind Variable: content_type
--    - Source Type: Request Body
--    - Access Method: IN
--    - Data Type: STRING
--    - Required: No
--
-- 16. requires_auth
--    - Bind Variable: requires_auth
--    - Source Type: Request Body
--    - Access Method: IN
--    - Data Type: STRING
--    - Required: No
--
-- 17. auth_type
--    - Bind Variable: auth_type
--    - Source Type: Request Body
--    - Access Method: IN
--    - Data Type: STRING
--    - Required: No
--
-- 18. auth_header_name
--    - Bind Variable: auth_header_name
--    - Source Type: Request Body
--    - Access Method: IN
--    - Data Type: STRING
--    - Required: No
--
-- 19. auth_value_encrypted
--    - Bind Variable: auth_value_encrypted
--    - Source Type: Request Body
--    - Access Method: IN
--    - Data Type: STRING
--    - Required: No
--
-- 20. timeout_seconds
--    - Bind Variable: timeout_seconds
--    - Source Type: Request Body
--    - Access Method: IN
--    - Data Type: STRING
--    - Required: No
--
-- 21. retry_count
--    - Bind Variable: retry_count
--    - Source Type: Request Body
--    - Access Method: IN
--    - Data Type: STRING
--    - Required: No
--
-- 22. cache_enabled
--    - Bind Variable: cache_enabled
--    - Source Type: Request Body
--    - Access Method: IN
--    - Data Type: STRING
--    - Required: No
--
-- 23. cache_duration_seconds
--    - Bind Variable: cache_duration_seconds
--    - Source Type: Request Body
--    - Access Method: IN
--    - Data Type: STRING
--    - Required: No
--
-- 24. copilot_enabled
--    - Bind Variable: copilot_enabled
--    - Source Type: Request Body
--    - Access Method: IN
--    - Data Type: STRING
--    - Required: No
--
-- 25. copilot_prompt
--    - Bind Variable: copilot_prompt
--    - Source Type: Request Body
--    - Access Method: IN
--    - Data Type: STRING
--    - Required: No
--
-- 26. copilot_parameters
--    - Bind Variable: copilot_parameters
--    - Source Type: Request Body
--    - Access Method: IN
--    - Data Type: STRING
--    - Required: No
--
-- 27. is_active
--    - Bind Variable: is_active
--    - Source Type: Request Body
--    - Access Method: IN
--    - Data Type: STRING
--    - Required: No
--
-- 28. created_by
--    - Bind Variable: created_by
--    - Source Type: Request Body
--    - Access Method: IN
--    - Data Type: STRING
--    - Required: No
--
-- ============================================================================

-- ============================================================================
-- TEST WITH FULL JSON PAYLOAD
-- ============================================================================
/*
POST https://apex.oracle.com/pls/apex/grays/api/rr/endpoints/

Headers:
Content-Type: application/json

Body:
{
  "module_code": "GL",
  "feature_name": "Get Account Balances",
  "page_name": "Account Inquiry",
  "http_method": "GET",
  "workspace_id": 1,
  "workspace_url": "https://apex.oracle.com/pls/apex/grays/",
  "endpoint_path": "api/gl/account-balances",
  "request_params": "{\"account_id\": 12345, \"period_name\": \"JAN-25\"}",
  "sample_request_body": null,
  "sample_response": "{\"success\": true, \"balance\": 15000.00}",
  "response_format": "JSON",
  "content_type": "application/json",
  "requires_auth": "Y",
  "auth_type": "BEARER",
  "auth_header_name": "Authorization",
  "auth_value_encrypted": "encrypted_token_value",
  "timeout_seconds": 45,
  "retry_count": 3,
  "cache_enabled": "Y",
  "cache_duration_seconds": 300,
  "copilot_enabled": "Y",
  "copilot_prompt": "Help me check account balances",
  "copilot_parameters": "{\"context\": \"account_inquiry\"}",
  "description": "Retrieves account balances for specified period",
  "notes": "Used in GL Account Inquiry screen",
  "tags": "GL,ACCOUNTS,BALANCES,INQUIRY",
  "is_active": "Y",
  "created_by": 1
}

Expected Response:
{
  "status": "SUCCESS",
  "message": "Endpoint created successfully with ID: 5",
  "data": {
    "endpoint_id": 5
  }
}
*/
