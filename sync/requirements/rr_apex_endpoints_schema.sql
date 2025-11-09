-- ============================================================================
-- RR_APEX_ENDPOINTS - APEX Endpoint Management Schema
-- Version: 1.0
-- Date: November 9, 2025
-- Prefix: RR_ (Standard for all tables, procedures, packages)
-- ============================================================================

-- ============================================================================
-- 1. WORKSPACES TABLE (Reusable workspace configurations)
-- ============================================================================
CREATE TABLE RR_APEX_WORKSPACES (
    WORKSPACE_ID            NUMBER PRIMARY KEY,
    WORKSPACE_NAME          VARCHAR2(100) NOT NULL UNIQUE,
    WORKSPACE_URL           VARCHAR2(500) NOT NULL,
    SCHEMA_NAME             VARCHAR2(100),
    ENVIRONMENT             VARCHAR2(20) CHECK (ENVIRONMENT IN ('DEV', 'TEST', 'UAT', 'PROD')),
    IS_DEFAULT              VARCHAR2(1) DEFAULT 'N' CHECK (IS_DEFAULT IN ('Y', 'N')),
    IS_ACTIVE               VARCHAR2(1) DEFAULT 'Y' CHECK (IS_ACTIVE IN ('Y', 'N')),
    DESCRIPTION             VARCHAR2(500),
    CREATED_DATE            DATE NOT NULL,
    CREATED_BY              NUMBER NOT NULL,
    LAST_UPDATE_DATE        DATE NOT NULL,
    LAST_UPDATED_BY         NUMBER NOT NULL
);

CREATE SEQUENCE RR_APEX_WORKSPACES_SEQ START WITH 1 INCREMENT BY 1;

CREATE INDEX RR_APEX_WORKSPACES_N1 ON RR_APEX_WORKSPACES(IS_ACTIVE);
CREATE INDEX RR_APEX_WORKSPACES_N2 ON RR_APEX_WORKSPACES(ENVIRONMENT);

COMMENT ON TABLE RR_APEX_WORKSPACES IS 'Stores reusable APEX workspace configurations';

-- Insert default workspace
INSERT INTO RR_APEX_WORKSPACES (
    WORKSPACE_ID, WORKSPACE_NAME, WORKSPACE_URL, SCHEMA_NAME,
    ENVIRONMENT, IS_DEFAULT, CREATED_DATE, CREATED_BY,
    LAST_UPDATE_DATE, LAST_UPDATED_BY
) VALUES (
    RR_APEX_WORKSPACES_SEQ.NEXTVAL,
    'GRAYS_PROD',
    'https://apex.oracle.com/pls/apex/grays/',
    'GRAYS_SCHEMA',
    'PROD',
    'Y',
    SYSDATE,
    0,
    SYSDATE,
    0
);

-- ============================================================================
-- 2. APEX ENDPOINTS TABLE (Main table for endpoint management)
-- ============================================================================
CREATE TABLE RR_APEX_ENDPOINTS (
    ENDPOINT_ID             NUMBER PRIMARY KEY,
    MODULE_CODE             VARCHAR2(30) NOT NULL CHECK (MODULE_CODE IN ('GL', 'AP', 'AR', 'FA', 'WMS', 'SYNC', 'PO', 'OM', 'CA', 'POS')),
    FEATURE_NAME            VARCHAR2(100) NOT NULL,
    PAGE_NAME               VARCHAR2(100),
    WORKSPACE_ID            NUMBER,
    WORKSPACE_URL           VARCHAR2(500) NOT NULL,
    ENDPOINT_PATH           VARCHAR2(500) NOT NULL,
    HTTP_METHOD             VARCHAR2(10) NOT NULL CHECK (HTTP_METHOD IN ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')),

    -- Request/Response Configuration
    REQUEST_PARAMS          CLOB,              -- JSON for GET query parameters
    SAMPLE_REQUEST_BODY     CLOB,              -- JSON for POST/PUT body
    SAMPLE_RESPONSE         CLOB,              -- JSON expected response
    RESPONSE_FORMAT         VARCHAR2(20) DEFAULT 'JSON' CHECK (RESPONSE_FORMAT IN ('JSON', 'XML', 'TEXT', 'HTML')),
    CONTENT_TYPE            VARCHAR2(100) DEFAULT 'application/json',

    -- Authentication
    REQUIRES_AUTH           VARCHAR2(1) DEFAULT 'N' CHECK (REQUIRES_AUTH IN ('Y', 'N')),
    AUTH_TYPE               VARCHAR2(20) CHECK (AUTH_TYPE IN ('BASIC', 'BEARER', 'API_KEY', 'OAUTH', 'JWT', 'NONE')),
    AUTH_HEADER_NAME        VARCHAR2(100),
    AUTH_VALUE_ENCRYPTED    VARCHAR2(1000),

    -- Performance & Configuration
    TIMEOUT_SECONDS         NUMBER DEFAULT 30,
    RETRY_COUNT             NUMBER DEFAULT 0,
    CACHE_ENABLED           VARCHAR2(1) DEFAULT 'N' CHECK (CACHE_ENABLED IN ('Y', 'N')),
    CACHE_DURATION_SECONDS  NUMBER,

    -- Testing & Monitoring
    LAST_TEST_DATE          TIMESTAMP,
    LAST_TEST_STATUS        VARCHAR2(20) CHECK (LAST_TEST_STATUS IN ('SUCCESS', 'FAILED', 'PENDING', 'ERROR')),
    LAST_TEST_RESPONSE      CLOB,
    LAST_TEST_DURATION_MS   NUMBER,
    LAST_TEST_ERROR         VARCHAR2(1000),
    TEST_COUNT              NUMBER DEFAULT 0,
    SUCCESS_COUNT           NUMBER DEFAULT 0,
    FAILURE_COUNT           NUMBER DEFAULT 0,

    -- Co-Pilot Integration (Future)
    COPILOT_ENABLED         VARCHAR2(1) DEFAULT 'N' CHECK (COPILOT_ENABLED IN ('Y', 'N')),
    COPILOT_PROMPT          VARCHAR2(1000),
    COPILOT_PARAMETERS      CLOB,              -- JSON mapping for co-pilot

    -- Status & Metadata
    IS_ACTIVE               VARCHAR2(1) DEFAULT 'Y' CHECK (IS_ACTIVE IN ('Y', 'N')),
    DESCRIPTION             VARCHAR2(500),
    NOTES                   CLOB,
    TAGS                    VARCHAR2(500),     -- Comma-separated tags for searching
    CREATED_DATE            DATE NOT NULL,
    CREATED_BY              NUMBER NOT NULL,
    LAST_UPDATE_DATE        DATE NOT NULL,
    LAST_UPDATED_BY         NUMBER NOT NULL,

    CONSTRAINT RR_APEX_ENDPOINTS_FK1 FOREIGN KEY (WORKSPACE_ID) REFERENCES RR_APEX_WORKSPACES(WORKSPACE_ID),
    CONSTRAINT RR_APEX_ENDPOINTS_U1 UNIQUE (MODULE_CODE, FEATURE_NAME, HTTP_METHOD)
);

CREATE SEQUENCE RR_APEX_ENDPOINTS_SEQ START WITH 1 INCREMENT BY 1;

CREATE INDEX RR_APEX_ENDPOINTS_N1 ON RR_APEX_ENDPOINTS(MODULE_CODE);
CREATE INDEX RR_APEX_ENDPOINTS_N2 ON RR_APEX_ENDPOINTS(HTTP_METHOD);
CREATE INDEX RR_APEX_ENDPOINTS_N3 ON RR_APEX_ENDPOINTS(IS_ACTIVE);
CREATE INDEX RR_APEX_ENDPOINTS_N4 ON RR_APEX_ENDPOINTS(FEATURE_NAME);
CREATE INDEX RR_APEX_ENDPOINTS_N5 ON RR_APEX_ENDPOINTS(WORKSPACE_ID);

COMMENT ON TABLE RR_APEX_ENDPOINTS IS 'Stores all APEX REST API endpoint configurations with testing capabilities';

-- ============================================================================
-- 3. ENDPOINT TEST HISTORY (Track all test executions)
-- ============================================================================
CREATE TABLE RR_ENDPOINT_TEST_HISTORY (
    TEST_ID                 NUMBER PRIMARY KEY,
    ENDPOINT_ID             NUMBER NOT NULL,
    TEST_DATE               TIMESTAMP NOT NULL,
    TEST_STATUS             VARCHAR2(20) CHECK (TEST_STATUS IN ('SUCCESS', 'FAILED', 'ERROR', 'TIMEOUT')),
    HTTP_STATUS_CODE        NUMBER,
    RESPONSE_TIME_MS        NUMBER,
    REQUEST_SENT            CLOB,
    RESPONSE_RECEIVED       CLOB,
    ERROR_MESSAGE           VARCHAR2(1000),
    TESTED_BY               NUMBER,
    CREATED_DATE            DATE NOT NULL,

    CONSTRAINT RR_ENDPOINT_TEST_HIST_FK1 FOREIGN KEY (ENDPOINT_ID) REFERENCES RR_APEX_ENDPOINTS(ENDPOINT_ID) ON DELETE CASCADE
);

CREATE SEQUENCE RR_ENDPOINT_TEST_HISTORY_SEQ START WITH 1 INCREMENT BY 1;

CREATE INDEX RR_ENDPOINT_TEST_HIST_N1 ON RR_ENDPOINT_TEST_HISTORY(ENDPOINT_ID);
CREATE INDEX RR_ENDPOINT_TEST_HIST_N2 ON RR_ENDPOINT_TEST_HISTORY(TEST_DATE);

COMMENT ON TABLE RR_ENDPOINT_TEST_HISTORY IS 'Tracks all endpoint test executions for monitoring and debugging';

-- ============================================================================
-- Sample Data - Default GL Endpoints
-- ============================================================================

-- Get Journals
INSERT INTO RR_APEX_ENDPOINTS (
    ENDPOINT_ID, MODULE_CODE, FEATURE_NAME, PAGE_NAME, WORKSPACE_ID,
    WORKSPACE_URL, ENDPOINT_PATH, HTTP_METHOD,
    REQUEST_PARAMS, SAMPLE_REQUEST_BODY, SAMPLE_RESPONSE,
    DESCRIPTION, REQUIRES_AUTH, AUTH_TYPE,
    CREATED_DATE, CREATED_BY, LAST_UPDATE_DATE, LAST_UPDATED_BY
) VALUES (
    RR_APEX_ENDPOINTS_SEQ.NEXTVAL,
    'GL',
    'Get Journals',
    'Journal Inquiry',
    1,
    'https://apex.oracle.com/pls/apex/grays/',
    'api/gl/journals',
    'GET',
    '{"limit": 100, "offset": 0, "status": "POSTED"}',
    NULL,
    '{"success": true, "count": 25, "data": [...]}',
    'Retrieve journal entries from APEX database',
    'Y',
    'BEARER',
    SYSDATE, 0, SYSDATE, 0
);

-- Create Journal
INSERT INTO RR_APEX_ENDPOINTS (
    ENDPOINT_ID, MODULE_CODE, FEATURE_NAME, PAGE_NAME, WORKSPACE_ID,
    WORKSPACE_URL, ENDPOINT_PATH, HTTP_METHOD,
    REQUEST_PARAMS, SAMPLE_REQUEST_BODY, SAMPLE_RESPONSE,
    DESCRIPTION, REQUIRES_AUTH, AUTH_TYPE,
    CREATED_DATE, CREATED_BY, LAST_UPDATE_DATE, LAST_UPDATED_BY
) VALUES (
    RR_APEX_ENDPOINTS_SEQ.NEXTVAL,
    'GL',
    'Create Journal',
    'Journal Entry',
    1,
    'https://apex.oracle.com/pls/apex/grays/',
    'api/gl/journals',
    'POST',
    NULL,
    '{"batch_name": "ADJ-001", "ledger_id": 1, "period_name": "JAN-25", "lines": [...]}',
    '{"success": true, "journal_id": 12345, "message": "Journal created"}',
    'Create new journal entry in APEX',
    'Y',
    'BEARER',
    SYSDATE, 0, SYSDATE, 0
);

-- GL Sync Endpoint
INSERT INTO RR_APEX_ENDPOINTS (
    ENDPOINT_ID, MODULE_CODE, FEATURE_NAME, PAGE_NAME, WORKSPACE_ID,
    WORKSPACE_URL, ENDPOINT_PATH, HTTP_METHOD,
    REQUEST_PARAMS, SAMPLE_REQUEST_BODY, SAMPLE_RESPONSE,
    DESCRIPTION, REQUIRES_AUTH, AUTH_TYPE,
    CREATED_DATE, CREATED_BY, LAST_UPDATE_DATE, LAST_UPDATED_BY
) VALUES (
    RR_APEX_ENDPOINTS_SEQ.NEXTVAL,
    'SYNC',
    'GL Sync',
    'GL Sync',
    1,
    'https://apex.oracle.com/pls/apex/grays/',
    'api/sync/gl',
    'POST',
    NULL,
    '{"batches": [...], "headers": [...], "lines": [...]}',
    '{"success": true, "inserted": 100, "updated": 25, "failed": 2}',
    'Sync GL data from Oracle Fusion to APEX',
    'Y',
    'BEARER',
    SYSDATE, 0, SYSDATE, 0
);

COMMIT;

-- ============================================================================
-- END OF SCHEMA
-- ============================================================================
