-- ============================================================================
-- APEX REST HANDLER - POST /api/rr/endpoints
-- Purpose: Create new endpoint in RR_APEX_ENDPOINTS table
-- ============================================================================

-- ============================================================================
-- STEP 1: Create the REST Module in APEX
-- ============================================================================
/*
In APEX:
1. Go to SQL Workshop > RESTful Services
2. Create Module:
   - Module Name: rr.endpoints
   - Base Path: /rr/endpoints/
   - Protected: Yes (requires authentication)

3. Create Template: (leave blank for root)
   - URI Template: (blank)

4. Create Handler:
   - Method: POST
   - Source Type: PL/SQL
   - Source: (use code below)
*/

-- ============================================================================
-- STEP 2: POST Handler Code
-- ============================================================================

DECLARE
    -- Input variables from JSON payload
    v_module_code           VARCHAR2(30);
    v_feature_name          VARCHAR2(100);
    v_page_name             VARCHAR2(100);
    v_http_method           VARCHAR2(10);
    v_workspace_id          NUMBER;
    v_workspace_url         VARCHAR2(500);
    v_endpoint_path         VARCHAR2(500);
    v_request_params        CLOB;
    v_sample_request_body   CLOB;
    v_sample_response       CLOB;
    v_response_format       VARCHAR2(20);
    v_content_type          VARCHAR2(100);
    v_requires_auth         VARCHAR2(1);
    v_auth_type             VARCHAR2(20);
    v_auth_header_name      VARCHAR2(100);
    v_auth_value_encrypted  VARCHAR2(4000);
    v_timeout_seconds       NUMBER;
    v_retry_count           NUMBER;
    v_cache_enabled         VARCHAR2(1);
    v_cache_duration_seconds NUMBER;
    v_copilot_enabled       VARCHAR2(1);
    v_copilot_prompt        VARCHAR2(4000);
    v_copilot_parameters    CLOB;
    v_description           VARCHAR2(4000);
    v_notes                 CLOB;
    v_tags                  VARCHAR2(500);
    v_is_active             VARCHAR2(1);
    v_created_by            NUMBER;

    -- Output variables
    v_endpoint_id           NUMBER;
    v_status                VARCHAR2(100);
    v_message               VARCHAR2(4000);

    -- Request body
    v_request_body          CLOB;
    v_json_obj              JSON_OBJECT_T;

BEGIN
    -- Get the request body
    v_request_body := :body_text;

    -- Parse JSON
    v_json_obj := JSON_OBJECT_T.parse(v_request_body);

    -- Extract required fields
    v_module_code           := v_json_obj.get_string('module_code');
    v_feature_name          := v_json_obj.get_string('feature_name');
    v_http_method           := v_json_obj.get_string('http_method');
    v_workspace_url         := v_json_obj.get_string('workspace_url');
    v_endpoint_path         := v_json_obj.get_string('endpoint_path');

    -- Extract optional fields with defaults
    v_page_name             := v_json_obj.get_string('page_name');

    -- Handle workspace_id (may be null)
    IF v_json_obj.has('workspace_id') AND NOT v_json_obj.get('workspace_id').is_null THEN
        v_workspace_id := v_json_obj.get_number('workspace_id');
    END IF;

    -- Extract CLOB fields
    IF v_json_obj.has('request_params') THEN
        v_request_params := v_json_obj.get_string('request_params');
    END IF;

    IF v_json_obj.has('sample_request_body') THEN
        v_sample_request_body := v_json_obj.get_string('sample_request_body');
    END IF;

    IF v_json_obj.has('sample_response') THEN
        v_sample_response := v_json_obj.get_string('sample_response');
    END IF;

    -- Extract other fields with defaults
    v_response_format       := NVL(v_json_obj.get_string('response_format'), 'JSON');
    v_content_type          := NVL(v_json_obj.get_string('content_type'), 'application/json');
    v_requires_auth         := NVL(v_json_obj.get_string('requires_auth'), 'N');
    v_auth_type             := NVL(v_json_obj.get_string('auth_type'), 'NONE');

    IF v_json_obj.has('auth_header_name') THEN
        v_auth_header_name := v_json_obj.get_string('auth_header_name');
    END IF;

    IF v_json_obj.has('auth_value_encrypted') THEN
        v_auth_value_encrypted := v_json_obj.get_string('auth_value_encrypted');
    END IF;

    -- Numeric fields with defaults
    v_timeout_seconds       := NVL(v_json_obj.get_number('timeout_seconds'), 30);
    v_retry_count           := NVL(v_json_obj.get_number('retry_count'), 0);

    IF v_json_obj.has('cache_duration_seconds') AND NOT v_json_obj.get('cache_duration_seconds').is_null THEN
        v_cache_duration_seconds := v_json_obj.get_number('cache_duration_seconds');
    END IF;

    v_cache_enabled         := NVL(v_json_obj.get_string('cache_enabled'), 'N');

    -- Co-pilot fields
    v_copilot_enabled       := NVL(v_json_obj.get_string('copilot_enabled'), 'N');

    IF v_json_obj.has('copilot_prompt') THEN
        v_copilot_prompt := v_json_obj.get_string('copilot_prompt');
    END IF;

    IF v_json_obj.has('copilot_parameters') THEN
        v_copilot_parameters := v_json_obj.get_string('copilot_parameters');
    END IF;

    -- Metadata fields
    IF v_json_obj.has('description') THEN
        v_description := v_json_obj.get_string('description');
    END IF;

    IF v_json_obj.has('notes') THEN
        v_notes := v_json_obj.get_string('notes');
    END IF;

    IF v_json_obj.has('tags') THEN
        v_tags := v_json_obj.get_string('tags');
    END IF;

    v_is_active             := NVL(v_json_obj.get_string('is_active'), 'Y');
    v_created_by            := v_json_obj.get_number('created_by');

    -- Call the PL/SQL package procedure
    RR_APEX_ENDPOINT_PKG.RR_CREATE_ENDPOINT(
        p_module_code           => v_module_code,
        p_feature_name          => v_feature_name,
        p_http_method           => v_http_method,
        p_workspace_url         => v_workspace_url,
        p_endpoint_path         => v_endpoint_path,
        p_page_name             => v_page_name,
        p_workspace_id          => v_workspace_id,
        p_request_params        => v_request_params,
        p_sample_request_body   => v_sample_request_body,
        p_sample_response       => v_sample_response,
        p_response_format       => v_response_format,
        p_content_type          => v_content_type,
        p_requires_auth         => v_requires_auth,
        p_auth_type             => v_auth_type,
        p_auth_header_name      => v_auth_header_name,
        p_auth_value_encrypted  => v_auth_value_encrypted,
        p_timeout_seconds       => v_timeout_seconds,
        p_retry_count           => v_retry_count,
        p_cache_enabled         => v_cache_enabled,
        p_cache_duration_seconds => v_cache_duration_seconds,
        p_copilot_enabled       => v_copilot_enabled,
        p_copilot_prompt        => v_copilot_prompt,
        p_copilot_parameters    => v_copilot_parameters,
        p_description           => v_description,
        p_notes                 => v_notes,
        p_tags                  => v_tags,
        p_is_active             => v_is_active,
        p_created_by            => v_created_by,
        p_endpoint_id           => v_endpoint_id,
        p_status                => v_status,
        p_message               => v_message
    );

    -- Set HTTP status code
    IF v_status = 'SUCCESS' THEN
        :status_code := 201; -- Created
    ELSE
        :status_code := 400; -- Bad Request
    END IF;

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
        :status_code := 500;
        apex_json.open_object;
        apex_json.write('status', 'ERROR');
        apex_json.write('message', 'Internal server error: ' || SQLERRM);
        apex_json.write('data', NULL);
        apex_json.close_object;
END;

-- ============================================================================
-- ALTERNATE VERSION: Using APEX's Built-in Bind Variables
-- ============================================================================

/*
-- If you prefer to use APEX bind variables instead of parsing JSON:

DECLARE
    v_endpoint_id           NUMBER;
    v_status                VARCHAR2(100);
    v_message               VARCHAR2(4000);
BEGIN
    RR_APEX_ENDPOINT_PKG.RR_CREATE_ENDPOINT(
        p_module_code           => :module_code,
        p_feature_name          => :feature_name,
        p_http_method           => :http_method,
        p_workspace_url         => :workspace_url,
        p_endpoint_path         => :endpoint_path,
        p_page_name             => :page_name,
        p_workspace_id          => :workspace_id,
        p_request_params        => :request_params,
        p_sample_request_body   => :sample_request_body,
        p_sample_response       => :sample_response,
        p_response_format       => NVL(:response_format, 'JSON'),
        p_content_type          => NVL(:content_type, 'application/json'),
        p_requires_auth         => NVL(:requires_auth, 'N'),
        p_auth_type             => NVL(:auth_type, 'NONE'),
        p_auth_header_name      => :auth_header_name,
        p_auth_value_encrypted  => :auth_value_encrypted,
        p_timeout_seconds       => NVL(:timeout_seconds, 30),
        p_retry_count           => NVL(:retry_count, 0),
        p_cache_enabled         => NVL(:cache_enabled, 'N'),
        p_cache_duration_seconds => :cache_duration_seconds,
        p_copilot_enabled       => NVL(:copilot_enabled, 'N'),
        p_copilot_prompt        => :copilot_prompt,
        p_copilot_parameters    => :copilot_parameters,
        p_description           => :description,
        p_notes                 => :notes,
        p_tags                  => :tags,
        p_is_active             => NVL(:is_active, 'Y'),
        p_created_by            => :created_by,
        p_endpoint_id           => v_endpoint_id,
        p_status                => v_status,
        p_message               => v_message
    );

    IF v_status = 'SUCCESS' THEN
        :status_code := 201;
    ELSE
        :status_code := 400;
    END IF;

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
        :status_code := 500;
        apex_json.open_object;
        apex_json.write('status', 'ERROR');
        apex_json.write('message', 'Internal server error: ' || SQLERRM);
        apex_json.write('data', NULL);
        apex_json.close_object;
END;
*/

-- ============================================================================
-- STEP 3: Testing the POST Endpoint
-- ============================================================================

/*
-- Test using SQL*Plus or SQL Developer:

-- Enable DBMS_OUTPUT
SET SERVEROUTPUT ON

-- Simulate the POST call
DECLARE
    v_endpoint_id   NUMBER;
    v_status        VARCHAR2(100);
    v_message       VARCHAR2(4000);
BEGIN
    RR_APEX_ENDPOINT_PKG.RR_CREATE_ENDPOINT(
        p_module_code           => 'GL',
        p_feature_name          => 'Test Endpoint',
        p_http_method           => 'GET',
        p_workspace_url         => 'https://apex.oracle.com/pls/apex/grays/',
        p_endpoint_path         => 'api/gl/test',
        p_description           => 'Test endpoint creation',
        p_created_by            => 1,
        p_endpoint_id           => v_endpoint_id,
        p_status                => v_status,
        p_message               => v_message
    );

    DBMS_OUTPUT.PUT_LINE('Status: ' || v_status);
    DBMS_OUTPUT.PUT_LINE('Message: ' || v_message);
    DBMS_OUTPUT.PUT_LINE('Endpoint ID: ' || v_endpoint_id);
END;
/

-- Test using cURL (from command line):
curl -X POST "https://apex.oracle.com/pls/apex/grays/api/rr/endpoints/" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{
    "module_code": "GL",
    "feature_name": "Get Journal Batches",
    "http_method": "GET",
    "workspace_url": "https://apex.oracle.com/pls/apex/grays/",
    "endpoint_path": "api/gl/journal-batches",
    "description": "Retrieve all journal batches",
    "requires_auth": "Y",
    "auth_type": "BEARER",
    "created_by": 1
  }'

-- Test using JavaScript fetch:
const response = await fetch('https://apex.oracle.com/pls/apex/grays/api/rr/endpoints/', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_TOKEN_HERE'
  },
  body: JSON.stringify({
    module_code: 'GL',
    feature_name: 'Get Journal Batches',
    http_method: 'GET',
    workspace_url: 'https://apex.oracle.com/pls/apex/grays/',
    endpoint_path: 'api/gl/journal-batches',
    description: 'Retrieve all journal batches',
    requires_auth: 'Y',
    auth_type: 'BEARER',
    created_by: 1
  })
});

const result = await response.json();
console.log('Endpoint ID:', result.data.endpoint_id);
console.log('Status:', result.status);
console.log('Message:', result.message);
*/

-- ============================================================================
-- STEP 4: Complete REST Module Setup
-- ============================================================================

/*
Create all handlers in APEX:

1. POST /api/rr/endpoints/
   - Method: POST
   - Source: (code above)

2. GET /api/rr/endpoints/:endpoint_id
   - Method: GET
   - Template: :endpoint_id
   - Source: (see rr_apex_rest_get_handlers.sql)

3. GET /api/rr/endpoints/
   - Method: GET
   - Source: (see rr_apex_rest_get_handlers.sql)

4. PATCH /api/rr/endpoints/:endpoint_id
   - Method: PATCH
   - Template: :endpoint_id
   - Source: (see rr_apex_rest_patch_handler.sql)

5. DELETE /api/rr/endpoints/:endpoint_id
   - Method: DELETE
   - Template: :endpoint_id
   - Source: (see rr_apex_rest_delete_handler.sql)

6. POST /api/rr/endpoints/:endpoint_id/test
   - Method: POST
   - Template: :endpoint_id/test
   - Source: (see rr_apex_rest_test_handler.sql)
*/

-- ============================================================================
-- STEP 5: Enable CORS (if calling from external domain)
-- ============================================================================

/*
In APEX RESTful Services:
1. Go to your module settings
2. Enable CORS
3. Set allowed origins: * (or specific domain)
4. Set allowed methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
5. Set allowed headers: Content-Type, Authorization
*/

-- ============================================================================
-- Sample Minimal JSON Request
-- ============================================================================

/*
Minimum required fields:

{
  "module_code": "GL",
  "feature_name": "Test Endpoint",
  "http_method": "GET",
  "workspace_url": "https://apex.oracle.com/pls/apex/grays/",
  "endpoint_path": "api/test",
  "created_by": 1
}

Full example with all fields:

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
*/
