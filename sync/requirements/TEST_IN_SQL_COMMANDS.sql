-- ============================================================================
-- SIMPLE TEST - Run this in SQL Commands to verify package works
-- NO BIND VARIABLES - NO ERRORS
-- ============================================================================

SET SERVEROUTPUT ON

DECLARE
    v_endpoint_id   NUMBER;
    v_status        VARCHAR2(100);
    v_message       VARCHAR2(4000);
BEGIN
    DBMS_OUTPUT.PUT_LINE('Testing RR_CREATE_ENDPOINT...');
    DBMS_OUTPUT.PUT_LINE('================================');

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

    IF v_status = 'SUCCESS' THEN
        DBMS_OUTPUT.PUT_LINE('');
        DBMS_OUTPUT.PUT_LINE('✓ SUCCESS! Package is working correctly.');
    ELSE
        DBMS_OUTPUT.PUT_LINE('');
        DBMS_OUTPUT.PUT_LINE('✗ FAILED! Check the error message above.');
    END IF;
END;
/

-- Verify the record was created
SELECT
    ENDPOINT_ID,
    MODULE_CODE,
    FEATURE_NAME,
    HTTP_METHOD,
    WORKSPACE_URL,
    ENDPOINT_PATH,
    CREATED_DATE
FROM RR_APEX_ENDPOINTS
WHERE FEATURE_NAME = 'Test Endpoint';
