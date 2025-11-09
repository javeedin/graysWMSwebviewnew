-- ============================================================================
-- RR_APEX_ENDPOINT_PKG - APEX Endpoint Management Package
-- Version: 1.0
-- Date: November 9, 2025
-- ============================================================================

-- ============================================================================
-- PACKAGE SPECIFICATION
-- ============================================================================
CREATE OR REPLACE PACKAGE RR_APEX_ENDPOINT_PKG AS

    -- ========================================================================
    -- CREATE ENDPOINT (POST)
    -- ========================================================================
    PROCEDURE RR_CREATE_ENDPOINT (
        -- Required Parameters
        p_module_code           IN  VARCHAR2,
        p_feature_name          IN  VARCHAR2,
        p_http_method           IN  VARCHAR2,
        p_workspace_url         IN  VARCHAR2,
        p_endpoint_path         IN  VARCHAR2,

        -- Optional Parameters
        p_page_name             IN  VARCHAR2 DEFAULT NULL,
        p_workspace_id          IN  NUMBER DEFAULT NULL,
        p_request_params        IN  CLOB DEFAULT NULL,
        p_sample_request_body   IN  CLOB DEFAULT NULL,
        p_sample_response       IN  CLOB DEFAULT NULL,
        p_response_format       IN  VARCHAR2 DEFAULT 'JSON',
        p_content_type          IN  VARCHAR2 DEFAULT 'application/json',

        -- Authentication
        p_requires_auth         IN  VARCHAR2 DEFAULT 'N',
        p_auth_type             IN  VARCHAR2 DEFAULT 'NONE',
        p_auth_header_name      IN  VARCHAR2 DEFAULT NULL,
        p_auth_value_encrypted  IN  VARCHAR2 DEFAULT NULL,

        -- Performance & Configuration
        p_timeout_seconds       IN  NUMBER DEFAULT 30,
        p_retry_count           IN  NUMBER DEFAULT 0,
        p_cache_enabled         IN  VARCHAR2 DEFAULT 'N',
        p_cache_duration_seconds IN NUMBER DEFAULT NULL,

        -- Co-Pilot Integration
        p_copilot_enabled       IN  VARCHAR2 DEFAULT 'N',
        p_copilot_prompt        IN  VARCHAR2 DEFAULT NULL,
        p_copilot_parameters    IN  CLOB DEFAULT NULL,

        -- Metadata
        p_description           IN  VARCHAR2 DEFAULT NULL,
        p_notes                 IN  CLOB DEFAULT NULL,
        p_tags                  IN  VARCHAR2 DEFAULT NULL,
        p_is_active             IN  VARCHAR2 DEFAULT 'Y',
        p_created_by            IN  NUMBER,

        -- Output Parameters
        p_endpoint_id           OUT NUMBER,
        p_status                OUT VARCHAR2,
        p_message               OUT VARCHAR2
    );

    -- ========================================================================
    -- GET ENDPOINT BY ID
    -- ========================================================================
    PROCEDURE RR_GET_ENDPOINT (
        p_endpoint_id           IN  NUMBER,
        p_endpoint_rec          OUT SYS_REFCURSOR,
        p_status                OUT VARCHAR2,
        p_message               OUT VARCHAR2
    );

    -- ========================================================================
    -- GET ALL ENDPOINTS
    -- ========================================================================
    PROCEDURE RR_GET_ALL_ENDPOINTS (
        p_module_code           IN  VARCHAR2 DEFAULT NULL,
        p_is_active             IN  VARCHAR2 DEFAULT 'Y',
        p_limit                 IN  NUMBER DEFAULT 100,
        p_offset                IN  NUMBER DEFAULT 0,
        p_endpoints_cur         OUT SYS_REFCURSOR,
        p_total_count           OUT NUMBER,
        p_status                OUT VARCHAR2,
        p_message               OUT VARCHAR2
    );

    -- ========================================================================
    -- UPDATE ENDPOINT (PUT/PATCH)
    -- ========================================================================
    PROCEDURE RR_UPDATE_ENDPOINT (
        p_endpoint_id           IN  NUMBER,
        p_feature_name          IN  VARCHAR2 DEFAULT NULL,
        p_page_name             IN  VARCHAR2 DEFAULT NULL,
        p_workspace_id          IN  NUMBER DEFAULT NULL,
        p_workspace_url         IN  VARCHAR2 DEFAULT NULL,
        p_endpoint_path         IN  VARCHAR2 DEFAULT NULL,
        p_http_method           IN  VARCHAR2 DEFAULT NULL,
        p_request_params        IN  CLOB DEFAULT NULL,
        p_sample_request_body   IN  CLOB DEFAULT NULL,
        p_sample_response       IN  CLOB DEFAULT NULL,
        p_response_format       IN  VARCHAR2 DEFAULT NULL,
        p_content_type          IN  VARCHAR2 DEFAULT NULL,
        p_requires_auth         IN  VARCHAR2 DEFAULT NULL,
        p_auth_type             IN  VARCHAR2 DEFAULT NULL,
        p_timeout_seconds       IN  NUMBER DEFAULT NULL,
        p_description           IN  VARCHAR2 DEFAULT NULL,
        p_is_active             IN  VARCHAR2 DEFAULT NULL,
        p_last_updated_by       IN  NUMBER,
        p_status                OUT VARCHAR2,
        p_message               OUT VARCHAR2
    );

    -- ========================================================================
    -- DELETE ENDPOINT
    -- ========================================================================
    PROCEDURE RR_DELETE_ENDPOINT (
        p_endpoint_id           IN  NUMBER,
        p_deleted_by            IN  NUMBER,
        p_status                OUT VARCHAR2,
        p_message               OUT VARCHAR2
    );

    -- ========================================================================
    -- TEST ENDPOINT
    -- ========================================================================
    PROCEDURE RR_TEST_ENDPOINT (
        p_endpoint_id           IN  NUMBER,
        p_tested_by             IN  NUMBER,
        p_test_id               OUT NUMBER,
        p_test_status           OUT VARCHAR2,
        p_response_time_ms      OUT NUMBER,
        p_http_status_code      OUT NUMBER,
        p_response_received     OUT CLOB,
        p_error_message         OUT VARCHAR2,
        p_status                OUT VARCHAR2,
        p_message               OUT VARCHAR2
    );

END RR_APEX_ENDPOINT_PKG;
/

-- ============================================================================
-- PACKAGE BODY
-- ============================================================================
CREATE OR REPLACE PACKAGE BODY RR_APEX_ENDPOINT_PKG AS

    -- ========================================================================
    -- CREATE ENDPOINT (POST) - Implementation
    -- ========================================================================
    PROCEDURE RR_CREATE_ENDPOINT (
        -- Required Parameters
        p_module_code           IN  VARCHAR2,
        p_feature_name          IN  VARCHAR2,
        p_http_method           IN  VARCHAR2,
        p_workspace_url         IN  VARCHAR2,
        p_endpoint_path         IN  VARCHAR2,

        -- Optional Parameters
        p_page_name             IN  VARCHAR2 DEFAULT NULL,
        p_workspace_id          IN  NUMBER DEFAULT NULL,
        p_request_params        IN  CLOB DEFAULT NULL,
        p_sample_request_body   IN  CLOB DEFAULT NULL,
        p_sample_response       IN  CLOB DEFAULT NULL,
        p_response_format       IN  VARCHAR2 DEFAULT 'JSON',
        p_content_type          IN  VARCHAR2 DEFAULT 'application/json',

        -- Authentication
        p_requires_auth         IN  VARCHAR2 DEFAULT 'N',
        p_auth_type             IN  VARCHAR2 DEFAULT 'NONE',
        p_auth_header_name      IN  VARCHAR2 DEFAULT NULL,
        p_auth_value_encrypted  IN  VARCHAR2 DEFAULT NULL,

        -- Performance & Configuration
        p_timeout_seconds       IN  NUMBER DEFAULT 30,
        p_retry_count           IN  NUMBER DEFAULT 0,
        p_cache_enabled         IN  VARCHAR2 DEFAULT 'N',
        p_cache_duration_seconds IN NUMBER DEFAULT NULL,

        -- Co-Pilot Integration
        p_copilot_enabled       IN  VARCHAR2 DEFAULT 'N',
        p_copilot_prompt        IN  VARCHAR2 DEFAULT NULL,
        p_copilot_parameters    IN  CLOB DEFAULT NULL,

        -- Metadata
        p_description           IN  VARCHAR2 DEFAULT NULL,
        p_notes                 IN  CLOB DEFAULT NULL,
        p_tags                  IN  VARCHAR2 DEFAULT NULL,
        p_is_active             IN  VARCHAR2 DEFAULT 'Y',
        p_created_by            IN  NUMBER,

        -- Output Parameters
        p_endpoint_id           OUT NUMBER,
        p_status                OUT VARCHAR2,
        p_message               OUT VARCHAR2
    ) IS
        v_endpoint_id           NUMBER;
        v_duplicate_count       NUMBER;
        v_workspace_exists      NUMBER;

    BEGIN
        -- Validate required parameters
        IF p_module_code IS NULL THEN
            p_status := 'ERROR';
            p_message := 'Module code is required';
            RETURN;
        END IF;

        IF p_feature_name IS NULL THEN
            p_status := 'ERROR';
            p_message := 'Feature name is required';
            RETURN;
        END IF;

        IF p_http_method IS NULL THEN
            p_status := 'ERROR';
            p_message := 'HTTP method is required';
            RETURN;
        END IF;

        IF p_http_method NOT IN ('GET', 'POST', 'PUT', 'PATCH', 'DELETE') THEN
            p_status := 'ERROR';
            p_message := 'Invalid HTTP method. Must be GET, POST, PUT, PATCH, or DELETE';
            RETURN;
        END IF;

        IF p_workspace_url IS NULL THEN
            p_status := 'ERROR';
            p_message := 'Workspace URL is required';
            RETURN;
        END IF;

        IF p_endpoint_path IS NULL THEN
            p_status := 'ERROR';
            p_message := 'Endpoint path is required';
            RETURN;
        END IF;

        -- Validate module code
        IF p_module_code NOT IN ('GL', 'AP', 'AR', 'FA', 'WMS', 'SYNC', 'PO', 'OM', 'CA', 'POS') THEN
            p_status := 'ERROR';
            p_message := 'Invalid module code';
            RETURN;
        END IF;

        -- Check for duplicate endpoint (MODULE_CODE, FEATURE_NAME, HTTP_METHOD must be unique)
        SELECT COUNT(*)
        INTO v_duplicate_count
        FROM RR_APEX_ENDPOINTS
        WHERE MODULE_CODE = p_module_code
          AND FEATURE_NAME = p_feature_name
          AND HTTP_METHOD = p_http_method;

        IF v_duplicate_count > 0 THEN
            p_status := 'ERROR';
            p_message := 'Duplicate endpoint: ' || p_module_code || ' - ' || p_feature_name || ' - ' || p_http_method || ' already exists';
            RETURN;
        END IF;

        -- Validate workspace_id if provided
        IF p_workspace_id IS NOT NULL THEN
            SELECT COUNT(*)
            INTO v_workspace_exists
            FROM RR_APEX_WORKSPACES
            WHERE WORKSPACE_ID = p_workspace_id
              AND IS_ACTIVE = 'Y';

            IF v_workspace_exists = 0 THEN
                p_status := 'ERROR';
                p_message := 'Invalid or inactive workspace_id';
                RETURN;
            END IF;
        END IF;

        -- Generate new endpoint ID
        SELECT RR_APEX_ENDPOINTS_SEQ.NEXTVAL INTO v_endpoint_id FROM DUAL;

        -- Insert the new endpoint
        INSERT INTO RR_APEX_ENDPOINTS (
            ENDPOINT_ID,
            MODULE_CODE,
            FEATURE_NAME,
            PAGE_NAME,
            WORKSPACE_ID,
            WORKSPACE_URL,
            ENDPOINT_PATH,
            HTTP_METHOD,
            REQUEST_PARAMS,
            SAMPLE_REQUEST_BODY,
            SAMPLE_RESPONSE,
            RESPONSE_FORMAT,
            CONTENT_TYPE,
            REQUIRES_AUTH,
            AUTH_TYPE,
            AUTH_HEADER_NAME,
            AUTH_VALUE_ENCRYPTED,
            TIMEOUT_SECONDS,
            RETRY_COUNT,
            CACHE_ENABLED,
            CACHE_DURATION_SECONDS,
            COPILOT_ENABLED,
            COPILOT_PROMPT,
            COPILOT_PARAMETERS,
            IS_ACTIVE,
            DESCRIPTION,
            NOTES,
            TAGS,
            CREATED_DATE,
            CREATED_BY,
            LAST_UPDATE_DATE,
            LAST_UPDATED_BY
        ) VALUES (
            v_endpoint_id,
            p_module_code,
            p_feature_name,
            p_page_name,
            p_workspace_id,
            p_workspace_url,
            p_endpoint_path,
            p_http_method,
            p_request_params,
            p_sample_request_body,
            p_sample_response,
            p_response_format,
            p_content_type,
            p_requires_auth,
            p_auth_type,
            p_auth_header_name,
            p_auth_value_encrypted,
            p_timeout_seconds,
            p_retry_count,
            p_cache_enabled,
            p_cache_duration_seconds,
            p_copilot_enabled,
            p_copilot_prompt,
            p_copilot_parameters,
            p_is_active,
            p_description,
            p_notes,
            p_tags,
            SYSDATE,
            p_created_by,
            SYSDATE,
            p_created_by
        );

        COMMIT;

        -- Return success
        p_endpoint_id := v_endpoint_id;
        p_status := 'SUCCESS';
        p_message := 'Endpoint created successfully with ID: ' || v_endpoint_id;

    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            p_status := 'ERROR';
            p_message := 'Error creating endpoint: ' || SQLERRM;
            p_endpoint_id := NULL;
    END RR_CREATE_ENDPOINT;

    -- ========================================================================
    -- GET ENDPOINT BY ID - Implementation
    -- ========================================================================
    PROCEDURE RR_GET_ENDPOINT (
        p_endpoint_id           IN  NUMBER,
        p_endpoint_rec          OUT SYS_REFCURSOR,
        p_status                OUT VARCHAR2,
        p_message               OUT VARCHAR2
    ) IS
    BEGIN
        OPEN p_endpoint_rec FOR
            SELECT
                e.*,
                w.WORKSPACE_NAME,
                w.ENVIRONMENT
            FROM RR_APEX_ENDPOINTS e
            LEFT JOIN RR_APEX_WORKSPACES w ON e.WORKSPACE_ID = w.WORKSPACE_ID
            WHERE e.ENDPOINT_ID = p_endpoint_id;

        p_status := 'SUCCESS';
        p_message := 'Endpoint retrieved successfully';

    EXCEPTION
        WHEN OTHERS THEN
            p_status := 'ERROR';
            p_message := 'Error retrieving endpoint: ' || SQLERRM;
    END RR_GET_ENDPOINT;

    -- ========================================================================
    -- GET ALL ENDPOINTS - Implementation
    -- ========================================================================
    PROCEDURE RR_GET_ALL_ENDPOINTS (
        p_module_code           IN  VARCHAR2 DEFAULT NULL,
        p_is_active             IN  VARCHAR2 DEFAULT 'Y',
        p_limit                 IN  NUMBER DEFAULT 100,
        p_offset                IN  NUMBER DEFAULT 0,
        p_endpoints_cur         OUT SYS_REFCURSOR,
        p_total_count           OUT NUMBER,
        p_status                OUT VARCHAR2,
        p_message               OUT VARCHAR2
    ) IS
        v_sql                   VARCHAR2(4000);
        v_where_clause          VARCHAR2(1000) := ' WHERE 1=1 ';
    BEGIN
        -- Build dynamic WHERE clause
        IF p_module_code IS NOT NULL THEN
            v_where_clause := v_where_clause || ' AND e.MODULE_CODE = :module_code ';
        END IF;

        IF p_is_active IS NOT NULL THEN
            v_where_clause := v_where_clause || ' AND e.IS_ACTIVE = :is_active ';
        END IF;

        -- Get total count
        v_sql := 'SELECT COUNT(*) FROM RR_APEX_ENDPOINTS e ' || v_where_clause;

        IF p_module_code IS NOT NULL AND p_is_active IS NOT NULL THEN
            EXECUTE IMMEDIATE v_sql INTO p_total_count USING p_module_code, p_is_active;
        ELSIF p_module_code IS NOT NULL THEN
            EXECUTE IMMEDIATE v_sql INTO p_total_count USING p_module_code;
        ELSIF p_is_active IS NOT NULL THEN
            EXECUTE IMMEDIATE v_sql INTO p_total_count USING p_is_active;
        ELSE
            EXECUTE IMMEDIATE v_sql INTO p_total_count;
        END IF;

        -- Open cursor for paginated results
        v_sql := 'SELECT e.*, w.WORKSPACE_NAME, w.ENVIRONMENT ' ||
                 'FROM RR_APEX_ENDPOINTS e ' ||
                 'LEFT JOIN RR_APEX_WORKSPACES w ON e.WORKSPACE_ID = w.WORKSPACE_ID ' ||
                 v_where_clause ||
                 ' ORDER BY e.MODULE_CODE, e.FEATURE_NAME ' ||
                 ' OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY';

        IF p_module_code IS NOT NULL AND p_is_active IS NOT NULL THEN
            OPEN p_endpoints_cur FOR v_sql USING p_module_code, p_is_active, p_offset, p_limit;
        ELSIF p_module_code IS NOT NULL THEN
            OPEN p_endpoints_cur FOR v_sql USING p_module_code, p_offset, p_limit;
        ELSIF p_is_active IS NOT NULL THEN
            OPEN p_endpoints_cur FOR v_sql USING p_is_active, p_offset, p_limit;
        ELSE
            OPEN p_endpoints_cur FOR v_sql USING p_offset, p_limit;
        END IF;

        p_status := 'SUCCESS';
        p_message := 'Endpoints retrieved successfully. Total: ' || p_total_count;

    EXCEPTION
        WHEN OTHERS THEN
            p_status := 'ERROR';
            p_message := 'Error retrieving endpoints: ' || SQLERRM;
            p_total_count := 0;
    END RR_GET_ALL_ENDPOINTS;

    -- ========================================================================
    -- UPDATE ENDPOINT (PUT/PATCH) - Implementation
    -- ========================================================================
    PROCEDURE RR_UPDATE_ENDPOINT (
        p_endpoint_id           IN  NUMBER,
        p_feature_name          IN  VARCHAR2 DEFAULT NULL,
        p_page_name             IN  VARCHAR2 DEFAULT NULL,
        p_workspace_id          IN  NUMBER DEFAULT NULL,
        p_workspace_url         IN  VARCHAR2 DEFAULT NULL,
        p_endpoint_path         IN  VARCHAR2 DEFAULT NULL,
        p_http_method           IN  VARCHAR2 DEFAULT NULL,
        p_request_params        IN  CLOB DEFAULT NULL,
        p_sample_request_body   IN  CLOB DEFAULT NULL,
        p_sample_response       IN  CLOB DEFAULT NULL,
        p_response_format       IN  VARCHAR2 DEFAULT NULL,
        p_content_type          IN  VARCHAR2 DEFAULT NULL,
        p_requires_auth         IN  VARCHAR2 DEFAULT NULL,
        p_auth_type             IN  VARCHAR2 DEFAULT NULL,
        p_timeout_seconds       IN  NUMBER DEFAULT NULL,
        p_description           IN  VARCHAR2 DEFAULT NULL,
        p_is_active             IN  VARCHAR2 DEFAULT NULL,
        p_last_updated_by       IN  NUMBER,
        p_status                OUT VARCHAR2,
        p_message               OUT VARCHAR2
    ) IS
        v_exists                NUMBER;
    BEGIN
        -- Check if endpoint exists
        SELECT COUNT(*)
        INTO v_exists
        FROM RR_APEX_ENDPOINTS
        WHERE ENDPOINT_ID = p_endpoint_id;

        IF v_exists = 0 THEN
            p_status := 'ERROR';
            p_message := 'Endpoint ID ' || p_endpoint_id || ' not found';
            RETURN;
        END IF;

        -- Update only non-null parameters (PATCH behavior)
        UPDATE RR_APEX_ENDPOINTS
        SET
            FEATURE_NAME = NVL(p_feature_name, FEATURE_NAME),
            PAGE_NAME = NVL(p_page_name, PAGE_NAME),
            WORKSPACE_ID = NVL(p_workspace_id, WORKSPACE_ID),
            WORKSPACE_URL = NVL(p_workspace_url, WORKSPACE_URL),
            ENDPOINT_PATH = NVL(p_endpoint_path, ENDPOINT_PATH),
            HTTP_METHOD = NVL(p_http_method, HTTP_METHOD),
            REQUEST_PARAMS = NVL(p_request_params, REQUEST_PARAMS),
            SAMPLE_REQUEST_BODY = NVL(p_sample_request_body, SAMPLE_REQUEST_BODY),
            SAMPLE_RESPONSE = NVL(p_sample_response, SAMPLE_RESPONSE),
            RESPONSE_FORMAT = NVL(p_response_format, RESPONSE_FORMAT),
            CONTENT_TYPE = NVL(p_content_type, CONTENT_TYPE),
            REQUIRES_AUTH = NVL(p_requires_auth, REQUIRES_AUTH),
            AUTH_TYPE = NVL(p_auth_type, AUTH_TYPE),
            TIMEOUT_SECONDS = NVL(p_timeout_seconds, TIMEOUT_SECONDS),
            DESCRIPTION = NVL(p_description, DESCRIPTION),
            IS_ACTIVE = NVL(p_is_active, IS_ACTIVE),
            LAST_UPDATE_DATE = SYSDATE,
            LAST_UPDATED_BY = p_last_updated_by
        WHERE ENDPOINT_ID = p_endpoint_id;

        COMMIT;

        p_status := 'SUCCESS';
        p_message := 'Endpoint updated successfully';

    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            p_status := 'ERROR';
            p_message := 'Error updating endpoint: ' || SQLERRM;
    END RR_UPDATE_ENDPOINT;

    -- ========================================================================
    -- DELETE ENDPOINT - Implementation
    -- ========================================================================
    PROCEDURE RR_DELETE_ENDPOINT (
        p_endpoint_id           IN  NUMBER,
        p_deleted_by            IN  NUMBER,
        p_status                OUT VARCHAR2,
        p_message               OUT VARCHAR2
    ) IS
        v_exists                NUMBER;
    BEGIN
        -- Check if endpoint exists
        SELECT COUNT(*)
        INTO v_exists
        FROM RR_APEX_ENDPOINTS
        WHERE ENDPOINT_ID = p_endpoint_id;

        IF v_exists = 0 THEN
            p_status := 'ERROR';
            p_message := 'Endpoint ID ' || p_endpoint_id || ' not found';
            RETURN;
        END IF;

        -- Delete endpoint (cascade will delete test history)
        DELETE FROM RR_APEX_ENDPOINTS
        WHERE ENDPOINT_ID = p_endpoint_id;

        COMMIT;

        p_status := 'SUCCESS';
        p_message := 'Endpoint deleted successfully';

    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            p_status := 'ERROR';
            p_message := 'Error deleting endpoint: ' || SQLERRM;
    END RR_DELETE_ENDPOINT;

    -- ========================================================================
    -- TEST ENDPOINT - Implementation
    -- ========================================================================
    PROCEDURE RR_TEST_ENDPOINT (
        p_endpoint_id           IN  NUMBER,
        p_tested_by             IN  NUMBER,
        p_test_id               OUT NUMBER,
        p_test_status           OUT VARCHAR2,
        p_response_time_ms      OUT NUMBER,
        p_http_status_code      OUT NUMBER,
        p_response_received     OUT CLOB,
        p_error_message         OUT VARCHAR2,
        p_status                OUT VARCHAR2,
        p_message               OUT VARCHAR2
    ) IS
        v_test_id               NUMBER;
        v_start_time            TIMESTAMP;
        v_end_time              TIMESTAMP;
        v_duration_ms           NUMBER;

        -- Endpoint details
        v_workspace_url         VARCHAR2(500);
        v_endpoint_path         VARCHAR2(500);
        v_http_method           VARCHAR2(10);
        v_exists                NUMBER;

    BEGIN
        v_start_time := SYSTIMESTAMP;

        -- Check if endpoint exists and get details
        SELECT COUNT(*)
        INTO v_exists
        FROM RR_APEX_ENDPOINTS
        WHERE ENDPOINT_ID = p_endpoint_id;

        IF v_exists = 0 THEN
            p_status := 'ERROR';
            p_message := 'Endpoint ID ' || p_endpoint_id || ' not found';
            RETURN;
        END IF;

        SELECT WORKSPACE_URL, ENDPOINT_PATH, HTTP_METHOD
        INTO v_workspace_url, v_endpoint_path, v_http_method
        FROM RR_APEX_ENDPOINTS
        WHERE ENDPOINT_ID = p_endpoint_id;

        -- Generate test ID
        SELECT RR_ENDPOINT_TEST_HISTORY_SEQ.NEXTVAL INTO v_test_id FROM DUAL;

        -- NOTE: Actual HTTP call would be done via UTL_HTTP or similar
        -- For now, we'll create a placeholder test record
        -- In production, you'd use UTL_HTTP to make the actual REST call

        v_end_time := SYSTIMESTAMP;
        v_duration_ms := EXTRACT(SECOND FROM (v_end_time - v_start_time)) * 1000;

        -- Insert test history record
        INSERT INTO RR_ENDPOINT_TEST_HISTORY (
            TEST_ID,
            ENDPOINT_ID,
            TEST_DATE,
            TEST_STATUS,
            HTTP_STATUS_CODE,
            RESPONSE_TIME_MS,
            REQUEST_SENT,
            RESPONSE_RECEIVED,
            ERROR_MESSAGE,
            TESTED_BY,
            CREATED_DATE
        ) VALUES (
            v_test_id,
            p_endpoint_id,
            SYSTIMESTAMP,
            'PENDING',  -- Will be updated after actual HTTP call
            NULL,
            v_duration_ms,
            'Test request for ' || v_workspace_url || v_endpoint_path,
            NULL,
            'Test functionality requires UTL_HTTP implementation',
            p_tested_by,
            SYSDATE
        );

        -- Update endpoint's last test info
        UPDATE RR_APEX_ENDPOINTS
        SET
            LAST_TEST_DATE = SYSTIMESTAMP,
            LAST_TEST_STATUS = 'PENDING',
            TEST_COUNT = NVL(TEST_COUNT, 0) + 1,
            LAST_UPDATE_DATE = SYSDATE,
            LAST_UPDATED_BY = p_tested_by
        WHERE ENDPOINT_ID = p_endpoint_id;

        COMMIT;

        p_test_id := v_test_id;
        p_test_status := 'PENDING';
        p_response_time_ms := v_duration_ms;
        p_http_status_code := NULL;
        p_response_received := NULL;
        p_error_message := 'Test functionality requires UTL_HTTP implementation';
        p_status := 'SUCCESS';
        p_message := 'Test record created with ID: ' || v_test_id;

    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            p_status := 'ERROR';
            p_message := 'Error testing endpoint: ' || SQLERRM;
            p_test_id := NULL;
    END RR_TEST_ENDPOINT;

END RR_APEX_ENDPOINT_PKG;
/

-- ============================================================================
-- Grant permissions (adjust as needed for your environment)
-- ============================================================================
-- GRANT EXECUTE ON RR_APEX_ENDPOINT_PKG TO APEX_PUBLIC_USER;
-- GRANT EXECUTE ON RR_APEX_ENDPOINT_PKG TO YOUR_APP_USER;

-- ============================================================================
-- Example usage
-- ============================================================================

/*
-- Example 1: Create a new endpoint (POST)
DECLARE
    v_endpoint_id   NUMBER;
    v_status        VARCHAR2(100);
    v_message       VARCHAR2(1000);
BEGIN
    RR_APEX_ENDPOINT_PKG.RR_CREATE_ENDPOINT(
        p_module_code           => 'GL',
        p_feature_name          => 'Get Account Balances',
        p_http_method           => 'GET',
        p_workspace_url         => 'https://apex.oracle.com/pls/apex/grays/',
        p_endpoint_path         => 'api/gl/balances',
        p_page_name             => 'Account Inquiry',
        p_workspace_id          => 1,
        p_request_params        => '{"account_id": 12345, "period_name": "JAN-25"}',
        p_sample_response       => '{"success": true, "balance": 15000.00}',
        p_description           => 'Get account balances for a specific period',
        p_requires_auth         => 'Y',
        p_auth_type             => 'BEARER',
        p_created_by            => 0,
        p_endpoint_id           => v_endpoint_id,
        p_status                => v_status,
        p_message               => v_message
    );

    DBMS_OUTPUT.PUT_LINE('Status: ' || v_status);
    DBMS_OUTPUT.PUT_LINE('Message: ' || v_message);
    DBMS_OUTPUT.PUT_LINE('Endpoint ID: ' || v_endpoint_id);
END;
/

-- Example 2: Get all GL endpoints
DECLARE
    v_endpoints_cur SYS_REFCURSOR;
    v_total_count   NUMBER;
    v_status        VARCHAR2(100);
    v_message       VARCHAR2(1000);
BEGIN
    RR_APEX_ENDPOINT_PKG.RR_GET_ALL_ENDPOINTS(
        p_module_code       => 'GL',
        p_is_active         => 'Y',
        p_limit             => 10,
        p_offset            => 0,
        p_endpoints_cur     => v_endpoints_cur,
        p_total_count       => v_total_count,
        p_status            => v_status,
        p_message           => v_message
    );

    DBMS_OUTPUT.PUT_LINE('Status: ' || v_status);
    DBMS_OUTPUT.PUT_LINE('Total Count: ' || v_total_count);

    -- Process cursor...
    CLOSE v_endpoints_cur;
END;
/

-- Example 3: Update an endpoint (PATCH)
DECLARE
    v_status        VARCHAR2(100);
    v_message       VARCHAR2(1000);
BEGIN
    RR_APEX_ENDPOINT_PKG.RR_UPDATE_ENDPOINT(
        p_endpoint_id           => 1,
        p_description           => 'Updated description',
        p_timeout_seconds       => 60,
        p_is_active             => 'Y',
        p_last_updated_by       => 0,
        p_status                => v_status,
        p_message               => v_message
    );

    DBMS_OUTPUT.PUT_LINE('Status: ' || v_status);
    DBMS_OUTPUT.PUT_LINE('Message: ' || v_message);
END;
/

-- Example 4: Test an endpoint
DECLARE
    v_test_id           NUMBER;
    v_test_status       VARCHAR2(20);
    v_response_time_ms  NUMBER;
    v_http_status_code  NUMBER;
    v_response_received CLOB;
    v_error_message     VARCHAR2(1000);
    v_status            VARCHAR2(100);
    v_message           VARCHAR2(1000);
BEGIN
    RR_APEX_ENDPOINT_PKG.RR_TEST_ENDPOINT(
        p_endpoint_id           => 1,
        p_tested_by             => 0,
        p_test_id               => v_test_id,
        p_test_status           => v_test_status,
        p_response_time_ms      => v_response_time_ms,
        p_http_status_code      => v_http_status_code,
        p_response_received     => v_response_received,
        p_error_message         => v_error_message,
        p_status                => v_status,
        p_message               => v_message
    );

    DBMS_OUTPUT.PUT_LINE('Status: ' || v_status);
    DBMS_OUTPUT.PUT_LINE('Test ID: ' || v_test_id);
    DBMS_OUTPUT.PUT_LINE('Response Time: ' || v_response_time_ms || 'ms');
END;
/

-- Example 5: Delete an endpoint
DECLARE
    v_status        VARCHAR2(100);
    v_message       VARCHAR2(1000);
BEGIN
    RR_APEX_ENDPOINT_PKG.RR_DELETE_ENDPOINT(
        p_endpoint_id           => 999,
        p_deleted_by            => 0,
        p_status                => v_status,
        p_message               => v_message
    );

    DBMS_OUTPUT.PUT_LINE('Status: ' || v_status);
    DBMS_OUTPUT.PUT_LINE('Message: ' || v_message);
END;
/
*/

-- ============================================================================
-- END OF PACKAGE
-- ============================================================================
