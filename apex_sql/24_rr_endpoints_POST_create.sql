-- ============================================================================
-- POST /rr/endpoints - Create New Endpoint
-- ============================================================================
--
-- This handler creates a new API endpoint configuration record
--
-- APEX REST Configuration:
-- - URI Template: endpoints
-- - Method: POST
-- - Source Type: PL/SQL
--
-- Expected JSON Request Body:
-- {
--   "module_code": "GL",
--   "feature_name": "Get Invoices",
--   "workspace_url": "https://apex.oracle.com/...",
--   "endpoint_path": "api/gl/invoices",
--   "http_method": "GET",
--   "content_type": "application/json",
--   "timeout_seconds": 30,
--   "retry_count": 0,
--   "description": "Fetch GL invoices",
--   "requires_auth": "Y",
--   "is_active": "Y",
--   "response_format": "JSON"
-- }
--
-- Response:
-- {
--   "status": "SUCCESS",
--   "message": "Endpoint created successfully",
--   "data": {
--     "endpoint_id": 123
--   }
-- }
-- ============================================================================

DECLARE
    -- Input variables from JSON body
    v_module_code VARCHAR2(20);
    v_feature_name VARCHAR2(200);
    v_workspace_url VARCHAR2(500);
    v_endpoint_path VARCHAR2(500);
    v_http_method VARCHAR2(20);
    v_content_type VARCHAR2(100);
    v_timeout_seconds NUMBER;
    v_retry_count NUMBER;
    v_description CLOB;
    v_requires_auth VARCHAR2(1);
    v_is_active VARCHAR2(1);
    v_response_format VARCHAR2(20);

    -- Output variables
    v_new_endpoint_id NUMBER;
    v_error_msg VARCHAR2(4000);

BEGIN
    -- Parse JSON from request body
    BEGIN
        SELECT
            JSON_VALUE(:body, '$.module_code'),
            JSON_VALUE(:body, '$.feature_name'),
            JSON_VALUE(:body, '$.workspace_url'),
            JSON_VALUE(:body, '$.endpoint_path'),
            UPPER(JSON_VALUE(:body, '$.http_method')),
            JSON_VALUE(:body, '$.content_type'),
            TO_NUMBER(JSON_VALUE(:body, '$.timeout_seconds')),
            TO_NUMBER(JSON_VALUE(:body, '$.retry_count')),
            JSON_VALUE(:body, '$.description'),
            UPPER(NVL(JSON_VALUE(:body, '$.requires_auth'), 'Y')),
            UPPER(NVL(JSON_VALUE(:body, '$.is_active'), 'Y')),
            NVL(JSON_VALUE(:body, '$.response_format'), 'JSON')
        INTO
            v_module_code,
            v_feature_name,
            v_workspace_url,
            v_endpoint_path,
            v_http_method,
            v_content_type,
            v_timeout_seconds,
            v_retry_count,
            v_description,
            v_requires_auth,
            v_is_active,
            v_response_format
        FROM DUAL;

    EXCEPTION
        WHEN OTHERS THEN
            v_error_msg := 'Invalid JSON format: ' || SQLERRM;
            HTP.p('{');
            HTP.p('"status":"ERROR",');
            HTP.p('"message":"' || REPLACE(v_error_msg, '"', '\"') || '"');
            HTP.p('}');
            RETURN;
    END;

    -- Validate required fields
    IF v_module_code IS NULL THEN
        HTP.p('{"status":"ERROR","message":"module_code is required"}');
        RETURN;
    END IF;

    IF v_feature_name IS NULL THEN
        HTP.p('{"status":"ERROR","message":"feature_name is required"}');
        RETURN;
    END IF;

    IF v_workspace_url IS NULL THEN
        HTP.p('{"status":"ERROR","message":"workspace_url is required"}');
        RETURN;
    END IF;

    IF v_endpoint_path IS NULL THEN
        HTP.p('{"status":"ERROR","message":"endpoint_path is required"}');
        RETURN;
    END IF;

    IF v_http_method IS NULL OR v_http_method NOT IN ('GET', 'POST', 'PUT', 'DELETE', 'PATCH') THEN
        HTP.p('{"status":"ERROR","message":"http_method must be GET, POST, PUT, DELETE, or PATCH"}');
        RETURN;
    END IF;

    -- Set defaults
    v_content_type := NVL(v_content_type, 'application/json');
    v_timeout_seconds := NVL(v_timeout_seconds, 30);
    v_retry_count := NVL(v_retry_count, 0);
    v_requires_auth := NVL(v_requires_auth, 'Y');
    v_is_active := NVL(v_is_active, 'Y');
    v_response_format := NVL(v_response_format, 'JSON');

    BEGIN
        -- Insert new endpoint record
        INSERT INTO RR_ENDPOINTS (
            MODULE_CODE,
            FEATURE_NAME,
            WORKSPACE_URL,
            ENDPOINT_PATH,
            HTTP_METHOD,
            CONTENT_TYPE,
            TIMEOUT_SECONDS,
            RETRY_COUNT,
            DESCRIPTION,
            REQUIRES_AUTH,
            IS_ACTIVE,
            RESPONSE_FORMAT,
            CREATED_DATE,
            MODIFIED_DATE,
            CREATED_BY,
            MODIFIED_BY
        ) VALUES (
            v_module_code,
            v_feature_name,
            v_workspace_url,
            v_endpoint_path,
            v_http_method,
            v_content_type,
            v_timeout_seconds,
            v_retry_count,
            v_description,
            v_requires_auth,
            v_is_active,
            v_response_format,
            SYSTIMESTAMP,
            SYSTIMESTAMP,
            'APEX_USER',
            'APEX_USER'
        ) RETURNING ENDPOINT_ID INTO v_new_endpoint_id;

        COMMIT;

        -- Return success response
        HTP.p('{');
        HTP.p('"status":"SUCCESS",');
        HTP.p('"message":"Endpoint created successfully",');
        HTP.p('"data":{');
        HTP.p('"endpoint_id":' || v_new_endpoint_id);
        HTP.p('}');
        HTP.p('}');

    EXCEPTION
        WHEN DUP_VAL_ON_INDEX THEN
            ROLLBACK;
            HTP.p('{"status":"ERROR","message":"Endpoint with same path already exists"}');

        WHEN OTHERS THEN
            ROLLBACK;
            v_error_msg := SQLERRM;
            HTP.p('{');
            HTP.p('"status":"ERROR",');
            HTP.p('"message":"Database error: ' || REPLACE(v_error_msg, '"', '\"') || '"');
            HTP.p('}');
    END;

END;
