-- ============================================================================
-- FINAL APEX REST HANDLER - POST /api/rr/endpoints/
-- PASTE THIS INTO: APEX → SQL Workshop → RESTful Services → POST Handler
-- ============================================================================

DECLARE
    v_endpoint_id   NUMBER;
    v_status        VARCHAR2(100);
    v_message       VARCHAR2(4000);
    v_body          CLOB;
BEGIN
    -- Get request body (try different APEX bind variables)
    BEGIN
        v_body := :body;
    EXCEPTION
        WHEN OTHERS THEN
            BEGIN
                v_body := :body_text;
            EXCEPTION
                WHEN OTHERS THEN
                    v_body := APEX_UTIL.CLOB_TO_VARCHAR2(:body);
            END;
    END;

    -- Call the package with JSON values
    RR_APEX_ENDPOINT_PKG.RR_CREATE_ENDPOINT(
        p_module_code           => APEX_JSON.get_varchar2(p_path => 'module_code'),
        p_feature_name          => APEX_JSON.get_varchar2(p_path => 'feature_name'),
        p_http_method           => APEX_JSON.get_varchar2(p_path => 'http_method'),
        p_workspace_url         => APEX_JSON.get_varchar2(p_path => 'workspace_url'),
        p_endpoint_path         => APEX_JSON.get_varchar2(p_path => 'endpoint_path'),
        p_page_name             => APEX_JSON.get_varchar2(p_path => 'page_name'),
        p_workspace_id          => APEX_JSON.get_number(p_path => 'workspace_id'),
        p_request_params        => APEX_JSON.get_clob(p_path => 'request_params'),
        p_sample_request_body   => APEX_JSON.get_clob(p_path => 'sample_request_body'),
        p_sample_response       => APEX_JSON.get_clob(p_path => 'sample_response'),
        p_response_format       => NVL(APEX_JSON.get_varchar2(p_path => 'response_format'), 'JSON'),
        p_content_type          => NVL(APEX_JSON.get_varchar2(p_path => 'content_type'), 'application/json'),
        p_requires_auth         => NVL(APEX_JSON.get_varchar2(p_path => 'requires_auth'), 'N'),
        p_auth_type             => NVL(APEX_JSON.get_varchar2(p_path => 'auth_type'), 'NONE'),
        p_auth_header_name      => APEX_JSON.get_varchar2(p_path => 'auth_header_name'),
        p_auth_value_encrypted  => APEX_JSON.get_varchar2(p_path => 'auth_value_encrypted'),
        p_timeout_seconds       => NVL(APEX_JSON.get_number(p_path => 'timeout_seconds'), 30),
        p_retry_count           => NVL(APEX_JSON.get_number(p_path => 'retry_count'), 0),
        p_cache_enabled         => NVL(APEX_JSON.get_varchar2(p_path => 'cache_enabled'), 'N'),
        p_cache_duration_seconds => APEX_JSON.get_number(p_path => 'cache_duration_seconds'),
        p_copilot_enabled       => NVL(APEX_JSON.get_varchar2(p_path => 'copilot_enabled'), 'N'),
        p_copilot_prompt        => APEX_JSON.get_varchar2(p_path => 'copilot_prompt'),
        p_copilot_parameters    => APEX_JSON.get_clob(p_path => 'copilot_parameters'),
        p_description           => APEX_JSON.get_varchar2(p_path => 'description'),
        p_notes                 => APEX_JSON.get_clob(p_path => 'notes'),
        p_tags                  => APEX_JSON.get_varchar2(p_path => 'tags'),
        p_is_active             => NVL(APEX_JSON.get_varchar2(p_path => 'is_active'), 'Y'),
        p_created_by            => NVL(APEX_JSON.get_number(p_path => 'created_by'), 1),
        p_endpoint_id           => v_endpoint_id,
        p_status                => v_status,
        p_message               => v_message
    );

    -- Set HTTP status
    :status := CASE WHEN v_status = 'SUCCESS' THEN 201 ELSE 400 END;

    -- Build response
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
-- SETUP INSTRUCTIONS FOR APEX
-- ============================================================================
/*

Step 1: Go to APEX
-----------------
SQL Workshop → RESTful Services


Step 2: Create Module
---------------------
Click "Create Module"
- Module Name: rr.endpoints
- Base Path: /rr/endpoints/
- Pagination: No pagination
- Source: [Leave default]
- Click "Create Module"


Step 3: Create Resource Template
--------------------------------
Under your module, click "Create Template"
- URI Template: [leave blank]
- Click "Create Template"


Step 4: Create POST Handler
---------------------------
Under the template, click "Create Handler"
- Method: POST
- Source Type: PL/SQL
- Source: [PASTE THE CODE ABOVE - from DECLARE to END;]
- MIME Types Allowed: application/json
- Click "Create Handler"


Step 5: Test the Endpoint
-------------------------
Use Postman, cURL, or JavaScript:

POST https://[your-apex-url]/pls/apex/grays/api/rr/endpoints/

Headers:
- Content-Type: application/json

Body:
{
  "module_code": "GL",
  "feature_name": "Test Endpoint",
  "http_method": "GET",
  "workspace_url": "https://apex.oracle.com/pls/apex/grays/",
  "endpoint_path": "api/gl/test",
  "description": "Test endpoint creation",
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

-- ============================================================================
-- TROUBLESHOOTING
-- ============================================================================
/*

If you get error 555:
--------------------
This means you're running the code in SQL Commands instead of RESTful Services.
The bind variables (:body, :status) only exist in REST handlers.

Solution:
- Use the test script: rr_test_endpoint_creation.sql in SQL Commands
- Use this handler code ONLY in APEX RESTful Services


If you get "package not found":
-------------------------------
Run this first:
1. rr_apex_endpoints_schema.sql (creates tables)
2. rr_apex_endpoint_pkg.sql (creates package)


If JSON parsing fails:
---------------------
Make sure Content-Type header is: application/json


If you get permission errors:
----------------------------
Grant execute on the package:
GRANT EXECUTE ON RR_APEX_ENDPOINT_PKG TO APEX_PUBLIC_USER;

*/
