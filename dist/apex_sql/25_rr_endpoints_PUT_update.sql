-- ============================================================================
-- PUT /rr/endpoints/:id - Update Existing Endpoint
-- ============================================================================
--
-- This handler updates an existing API endpoint configuration record
--
-- APEX REST Configuration:
-- - URI Template: endpoints/:id
-- - Method: PUT
-- - Source Type: PL/SQL
--
-- URL Parameters:
-- - id: The endpoint_id to update
--
-- Expected JSON Request Body:
-- {
--   "endpoint_id": 123,
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
--   "message": "Endpoint updated successfully",
--   "data": {
--     "endpoint_id": 123,
--     "rows_updated": 1
--   }
-- }
-- ============================================================================

DECLARE
    -- URL parameter
    v_endpoint_id NUMBER;

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
    v_rows_updated NUMBER;
    v_error_msg VARCHAR2(4000);

BEGIN
    -- Get endpoint_id from URL parameter
    v_endpoint_id := TO_NUMBER(:id);

    IF v_endpoint_id IS NULL THEN
        HTP.p('{"status":"ERROR","message":"endpoint_id is required in URL"}');
        RETURN;
    END IF;

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
            UPPER(JSON_VALUE(:body, '$.requires_auth')),
            UPPER(JSON_VALUE(:body, '$.is_active')),
            JSON_VALUE(:body, '$.response_format')
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

    BEGIN
        -- Update endpoint record
        UPDATE RR_ENDPOINTS
        SET
            MODULE_CODE = v_module_code,
            FEATURE_NAME = v_feature_name,
            WORKSPACE_URL = v_workspace_url,
            ENDPOINT_PATH = v_endpoint_path,
            HTTP_METHOD = v_http_method,
            CONTENT_TYPE = NVL(v_content_type, CONTENT_TYPE),
            TIMEOUT_SECONDS = NVL(v_timeout_seconds, TIMEOUT_SECONDS),
            RETRY_COUNT = NVL(v_retry_count, RETRY_COUNT),
            DESCRIPTION = NVL(v_description, DESCRIPTION),
            REQUIRES_AUTH = NVL(v_requires_auth, REQUIRES_AUTH),
            IS_ACTIVE = NVL(v_is_active, IS_ACTIVE),
            RESPONSE_FORMAT = NVL(v_response_format, RESPONSE_FORMAT),
            MODIFIED_DATE = SYSTIMESTAMP,
            MODIFIED_BY = 'APEX_USER'
        WHERE ENDPOINT_ID = v_endpoint_id;

        v_rows_updated := SQL%ROWCOUNT;

        IF v_rows_updated = 0 THEN
            ROLLBACK;
            HTP.p('{"status":"ERROR","message":"Endpoint not found with ID: ' || v_endpoint_id || '"}');
            RETURN;
        END IF;

        COMMIT;

        -- Return success response
        HTP.p('{');
        HTP.p('"status":"SUCCESS",');
        HTP.p('"message":"Endpoint updated successfully",');
        HTP.p('"data":{');
        HTP.p('"endpoint_id":' || v_endpoint_id || ',');
        HTP.p('"rows_updated":' || v_rows_updated);
        HTP.p('}');
        HTP.p('}');

    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            v_error_msg := SQLERRM;
            HTP.p('{');
            HTP.p('"status":"ERROR",');
            HTP.p('"message":"Database error: ' || REPLACE(v_error_msg, '"', '\"') || '"');
            HTP.p('}');
    END;

END;
