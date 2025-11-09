-- ============================================================================
-- TEST SCRIPT - Run this in SQL Commands/SQL Developer to test the package
-- ============================================================================

SET SERVEROUTPUT ON

DECLARE
    v_endpoint_id   NUMBER;
    v_status        VARCHAR2(100);
    v_message       VARCHAR2(4000);
BEGIN
    -- Test 1: Minimal required fields
    DBMS_OUTPUT.PUT_LINE('=== TEST 1: Create endpoint with minimal fields ===');

    RR_APEX_ENDPOINT_PKG.RR_CREATE_ENDPOINT(
        p_module_code           => 'GL',
        p_feature_name          => 'Test Endpoint 1',
        p_http_method           => 'GET',
        p_workspace_url         => 'https://apex.oracle.com/pls/apex/grays/',
        p_endpoint_path         => 'api/gl/test1',
        p_description           => 'Test endpoint creation',
        p_created_by            => 1,
        p_endpoint_id           => v_endpoint_id,
        p_status                => v_status,
        p_message               => v_message
    );

    DBMS_OUTPUT.PUT_LINE('Status: ' || v_status);
    DBMS_OUTPUT.PUT_LINE('Message: ' || v_message);
    DBMS_OUTPUT.PUT_LINE('Endpoint ID: ' || v_endpoint_id);
    DBMS_OUTPUT.PUT_LINE('');

    -- Test 2: With optional fields
    DBMS_OUTPUT.PUT_LINE('=== TEST 2: Create endpoint with optional fields ===');

    RR_APEX_ENDPOINT_PKG.RR_CREATE_ENDPOINT(
        p_module_code           => 'GL',
        p_feature_name          => 'Get Account Balances',
        p_page_name             => 'Account Inquiry',
        p_http_method           => 'GET',
        p_workspace_url         => 'https://apex.oracle.com/pls/apex/grays/',
        p_endpoint_path         => 'api/gl/account-balances',
        p_workspace_id          => 1,
        p_request_params        => '{"account_id": 12345, "period_name": "JAN-25"}',
        p_sample_response       => '{"success": true, "balance": 15000.00}',
        p_response_format       => 'JSON',
        p_content_type          => 'application/json',
        p_requires_auth         => 'Y',
        p_auth_type             => 'BEARER',
        p_timeout_seconds       => 45,
        p_copilot_enabled       => 'Y',
        p_copilot_prompt        => 'Help me check account balances',
        p_description           => 'Retrieves account balances for specified period',
        p_tags                  => 'GL,ACCOUNTS,BALANCES',
        p_is_active             => 'Y',
        p_created_by            => 1,
        p_endpoint_id           => v_endpoint_id,
        p_status                => v_status,
        p_message               => v_message
    );

    DBMS_OUTPUT.PUT_LINE('Status: ' || v_status);
    DBMS_OUTPUT.PUT_LINE('Message: ' || v_message);
    DBMS_OUTPUT.PUT_LINE('Endpoint ID: ' || v_endpoint_id);
    DBMS_OUTPUT.PUT_LINE('');

    -- Test 3: Duplicate should fail
    DBMS_OUTPUT.PUT_LINE('=== TEST 3: Duplicate endpoint (should fail) ===');

    RR_APEX_ENDPOINT_PKG.RR_CREATE_ENDPOINT(
        p_module_code           => 'GL',
        p_feature_name          => 'Test Endpoint 1',
        p_http_method           => 'GET',
        p_workspace_url         => 'https://apex.oracle.com/pls/apex/grays/',
        p_endpoint_path         => 'api/gl/test1-duplicate',
        p_created_by            => 1,
        p_endpoint_id           => v_endpoint_id,
        p_status                => v_status,
        p_message               => v_message
    );

    DBMS_OUTPUT.PUT_LINE('Status: ' || v_status);
    DBMS_OUTPUT.PUT_LINE('Message: ' || v_message);
    DBMS_OUTPUT.PUT_LINE('');

    -- Test 4: Invalid module code
    DBMS_OUTPUT.PUT_LINE('=== TEST 4: Invalid module code (should fail) ===');

    RR_APEX_ENDPOINT_PKG.RR_CREATE_ENDPOINT(
        p_module_code           => 'INVALID',
        p_feature_name          => 'Test Invalid',
        p_http_method           => 'GET',
        p_workspace_url         => 'https://apex.oracle.com/pls/apex/grays/',
        p_endpoint_path         => 'api/test',
        p_created_by            => 1,
        p_endpoint_id           => v_endpoint_id,
        p_status                => v_status,
        p_message               => v_message
    );

    DBMS_OUTPUT.PUT_LINE('Status: ' || v_status);
    DBMS_OUTPUT.PUT_LINE('Message: ' || v_message);
    DBMS_OUTPUT.PUT_LINE('');

    DBMS_OUTPUT.PUT_LINE('=== ALL TESTS COMPLETED ===');

EXCEPTION
    WHEN OTHERS THEN
        DBMS_OUTPUT.PUT_LINE('ERROR: ' || SQLERRM);
END;
/

-- Query created endpoints
SELECT
    ENDPOINT_ID,
    MODULE_CODE,
    FEATURE_NAME,
    HTTP_METHOD,
    ENDPOINT_PATH,
    IS_ACTIVE,
    CREATED_DATE
FROM RR_APEX_ENDPOINTS
ORDER BY ENDPOINT_ID DESC;
