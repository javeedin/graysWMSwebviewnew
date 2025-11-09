-- ============================================================================
-- DEBUG TEST - Simulates APEX REST Handler
-- Run this in SQL Commands to see the actual error
-- ============================================================================

SET SERVEROUTPUT ON

DECLARE
    v_endpoint_id   NUMBER;
    v_status        VARCHAR2(100);
    v_message       VARCHAR2(4000);
    v_body          CLOB;

    -- Simulate the POST request JSON body
    v_test_json     CLOB := '{
  "module_code": "GL",
  "feature_name": "Test Endpoint",
  "http_method": "GET",
  "workspace_url": "https://apex.oracle.com/pls/apex/grays/",
  "endpoint_path": "api/test",
  "created_by": 1
}';

BEGIN
    DBMS_OUTPUT.PUT_LINE('========================================');
    DBMS_OUTPUT.PUT_LINE('Testing APEX REST Handler Logic');
    DBMS_OUTPUT.PUT_LINE('========================================');
    DBMS_OUTPUT.PUT_LINE('');

    -- Simulate what APEX does
    v_body := v_test_json;

    DBMS_OUTPUT.PUT_LINE('Step 1: Parsing JSON...');
    BEGIN
        APEX_JSON.parse(v_body);
        DBMS_OUTPUT.PUT_LINE('✓ JSON parsed successfully');
    EXCEPTION
        WHEN OTHERS THEN
            DBMS_OUTPUT.PUT_LINE('✗ JSON parse failed: ' || SQLERRM);
            RAISE;
    END;

    DBMS_OUTPUT.PUT_LINE('');
    DBMS_OUTPUT.PUT_LINE('Step 2: Extracting values from JSON...');
    DBMS_OUTPUT.PUT_LINE('module_code: ' || APEX_JSON.get_varchar2(p_path => 'module_code'));
    DBMS_OUTPUT.PUT_LINE('feature_name: ' || APEX_JSON.get_varchar2(p_path => 'feature_name'));
    DBMS_OUTPUT.PUT_LINE('http_method: ' || APEX_JSON.get_varchar2(p_path => 'http_method'));
    DBMS_OUTPUT.PUT_LINE('workspace_url: ' || APEX_JSON.get_varchar2(p_path => 'workspace_url'));
    DBMS_OUTPUT.PUT_LINE('endpoint_path: ' || APEX_JSON.get_varchar2(p_path => 'endpoint_path'));
    DBMS_OUTPUT.PUT_LINE('created_by: ' || APEX_JSON.get_number(p_path => 'created_by'));

    DBMS_OUTPUT.PUT_LINE('');
    DBMS_OUTPUT.PUT_LINE('Step 3: Calling RR_CREATE_ENDPOINT...');

    BEGIN
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

        DBMS_OUTPUT.PUT_LINE('✓ Package call completed');

    EXCEPTION
        WHEN OTHERS THEN
            DBMS_OUTPUT.PUT_LINE('✗ Package call failed: ' || SQLERRM);
            DBMS_OUTPUT.PUT_LINE('Error Stack: ' || DBMS_UTILITY.FORMAT_ERROR_STACK);
            DBMS_OUTPUT.PUT_LINE('Error Backtrace: ' || DBMS_UTILITY.FORMAT_ERROR_BACKTRACE);
            RAISE;
    END;

    DBMS_OUTPUT.PUT_LINE('');
    DBMS_OUTPUT.PUT_LINE('========================================');
    DBMS_OUTPUT.PUT_LINE('RESULT:');
    DBMS_OUTPUT.PUT_LINE('========================================');
    DBMS_OUTPUT.PUT_LINE('Status: ' || v_status);
    DBMS_OUTPUT.PUT_LINE('Message: ' || v_message);
    DBMS_OUTPUT.PUT_LINE('Endpoint ID: ' || NVL(TO_CHAR(v_endpoint_id), 'NULL'));
    DBMS_OUTPUT.PUT_LINE('');

    -- Build the JSON response (same as APEX handler)
    DBMS_OUTPUT.PUT_LINE('JSON Response:');
    DBMS_OUTPUT.PUT_LINE('{');
    DBMS_OUTPUT.PUT_LINE('  "status":"' || v_status || '",');
    DBMS_OUTPUT.PUT_LINE('  "message":"' || REPLACE(v_message, '"', '\"') || '",');
    IF v_status = 'SUCCESS' THEN
        DBMS_OUTPUT.PUT_LINE('  "data":{"endpoint_id":' || v_endpoint_id || '}');
    ELSE
        DBMS_OUTPUT.PUT_LINE('  "data":null');
    END IF;
    DBMS_OUTPUT.PUT_LINE('}');
    DBMS_OUTPUT.PUT_LINE('');

    IF v_status = 'SUCCESS' THEN
        DBMS_OUTPUT.PUT_LINE('✓✓✓ TEST PASSED - Handler logic works correctly! ✓✓✓');
    ELSE
        DBMS_OUTPUT.PUT_LINE('✗✗✗ TEST FAILED - Check the error message above ✗✗✗');
    END IF;

EXCEPTION
    WHEN OTHERS THEN
        DBMS_OUTPUT.PUT_LINE('');
        DBMS_OUTPUT.PUT_LINE('========================================');
        DBMS_OUTPUT.PUT_LINE('FATAL ERROR:');
        DBMS_OUTPUT.PUT_LINE('========================================');
        DBMS_OUTPUT.PUT_LINE('Error: ' || SQLERRM);
        DBMS_OUTPUT.PUT_LINE('Stack: ' || DBMS_UTILITY.FORMAT_ERROR_STACK);
        DBMS_OUTPUT.PUT_LINE('Backtrace: ' || DBMS_UTILITY.FORMAT_ERROR_BACKTRACE);

        -- Build error JSON response
        DBMS_OUTPUT.PUT_LINE('');
        DBMS_OUTPUT.PUT_LINE('JSON Error Response:');
        DBMS_OUTPUT.PUT_LINE('{');
        DBMS_OUTPUT.PUT_LINE('  "status":"ERROR",');
        DBMS_OUTPUT.PUT_LINE('  "message":"' || REPLACE(SQLERRM, '"', '\"') || '",');
        DBMS_OUTPUT.PUT_LINE('  "data":null');
        DBMS_OUTPUT.PUT_LINE('}');
END;
/

-- Show the created record
SELECT
    ENDPOINT_ID,
    MODULE_CODE,
    FEATURE_NAME,
    HTTP_METHOD,
    WORKSPACE_URL,
    ENDPOINT_PATH,
    CREATED_DATE
FROM RR_APEX_ENDPOINTS
WHERE FEATURE_NAME = 'Test Endpoint'
ORDER BY ENDPOINT_ID DESC;
