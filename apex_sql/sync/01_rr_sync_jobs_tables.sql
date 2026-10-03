-- =====================================================
-- RR SYNC JOBS - Database Tables and Sequences
-- Part of Sync Module
-- =====================================================
-- Purpose: Create tables and sequences for Sync Jobs framework
-- Author: Claude Code
-- Date: 2025-11-10
-- =====================================================

-- Drop existing tables if they exist
BEGIN
    EXECUTE IMMEDIATE 'DROP TABLE RR_SYNC_JOBS_DETAILS CASCADE CONSTRAINTS';
    EXECUTE IMMEDIATE 'DROP TABLE RR_SYNC_JOBS_HEADER CASCADE CONSTRAINTS';
    EXECUTE IMMEDIATE 'DROP TABLE RR_SYNC_JOBS_MASTER CASCADE CONSTRAINTS';
    EXECUTE IMMEDIATE 'DROP SEQUENCE RR_SYNC_JOBS_DETAILS_SEQ';
    EXECUTE IMMEDIATE 'DROP SEQUENCE RR_SYNC_JOBS_HEADER_SEQ';
    EXECUTE IMMEDIATE 'DROP SEQUENCE RR_SYNC_JOBS_MASTER_SEQ';
EXCEPTION
    WHEN OTHERS THEN
        NULL; -- Tables don't exist yet
END;
/

-- =====================================================
-- 1. RR_SYNC_JOBS_MASTER - Catalog of Available Sync Jobs
-- =====================================================
-- This is the master catalog/template of all available sync operations
-- Admin sets this up once for each type of sync (GL Batches, AP Invoices, etc.)

CREATE TABLE RR_SYNC_JOBS_MASTER (
    JOB_MASTER_ID           NUMBER          NOT NULL,
    MODULE                  VARCHAR2(50)    NOT NULL,
    JOB_NAME                VARCHAR2(200)   NOT NULL,
    JOB_CODE                VARCHAR2(100)   NOT NULL,
    SOURCE_ENDPOINT         VARCHAR2(1000)  NOT NULL,
    DESTINATION_ENDPOINT    VARCHAR2(1000),
    API_TYPE                VARCHAR2(20)    DEFAULT 'REST',
    HTTP_METHOD             VARCHAR2(10)    DEFAULT 'GET',
    DESTINATION_PROCEDURE   VARCHAR2(200),
    DEFAULT_PARAMETERS      CLOB,
    AUTHENTICATION_TYPE     VARCHAR2(50)    DEFAULT 'BASIC',
    DESCRIPTION             VARCHAR2(4000),
    IS_ACTIVE               VARCHAR2(1)     DEFAULT 'Y',
    FIELD_MAPPING           CLOB,
    SORT_ORDER              NUMBER          DEFAULT 100,
    CREATED_DATE            TIMESTAMP(6)    DEFAULT SYSTIMESTAMP,
    CREATED_BY              VARCHAR2(100)   DEFAULT USER,
    UPDATED_DATE            TIMESTAMP(6),
    UPDATED_BY              VARCHAR2(100),

    CONSTRAINT RR_SYNC_JOBS_MASTER_PK PRIMARY KEY (JOB_MASTER_ID),
    CONSTRAINT RR_SYNC_JOBS_MASTER_UK1 UNIQUE (JOB_CODE),
    CONSTRAINT RR_SYNC_JOBS_MASTER_CK1 CHECK (API_TYPE IN ('REST', 'SOAP')),
    CONSTRAINT RR_SYNC_JOBS_MASTER_CK2 CHECK (HTTP_METHOD IN ('GET', 'POST', 'PUT', 'PATCH')),
    CONSTRAINT RR_SYNC_JOBS_MASTER_CK3 CHECK (IS_ACTIVE IN ('Y', 'N'))
);

CREATE SEQUENCE RR_SYNC_JOBS_MASTER_SEQ START WITH 1 INCREMENT BY 1;

-- Indexes for master table
CREATE INDEX RR_SYNC_JM_MODULE_IDX ON RR_SYNC_JOBS_MASTER(MODULE);
CREATE INDEX RR_SYNC_JM_ACTIVE_IDX ON RR_SYNC_JOBS_MASTER(IS_ACTIVE);
CREATE INDEX RR_SYNC_JM_CODE_IDX ON RR_SYNC_JOBS_MASTER(JOB_CODE);

-- Comments for master table
COMMENT ON TABLE RR_SYNC_JOBS_MASTER IS 'Master catalog of available sync job types';
COMMENT ON COLUMN RR_SYNC_JOBS_MASTER.JOB_CODE IS 'Unique identifier like GL_JOURNAL_BATCHES';
COMMENT ON COLUMN RR_SYNC_JOBS_MASTER.SOURCE_ENDPOINT IS 'Oracle Fusion API endpoint path';
COMMENT ON COLUMN RR_SYNC_JOBS_MASTER.DESTINATION_PROCEDURE IS 'APEX procedure to call for sync';
COMMENT ON COLUMN RR_SYNC_JOBS_MASTER.DEFAULT_PARAMETERS IS 'JSON with default query parameters';
COMMENT ON COLUMN RR_SYNC_JOBS_MASTER.FIELD_MAPPING IS 'JSON mapping Oracle Fusion fields to APEX fields';

-- =====================================================
-- 2. RR_SYNC_JOBS_HEADER - Configured Sync Job Instances
-- =====================================================
-- Users create sync job instances by selecting from master catalog
-- Each header represents a configured job with schedule and parameters

CREATE TABLE RR_SYNC_JOBS_HEADER (
    SYNC_JOB_ID             NUMBER          NOT NULL,
    JOB_MASTER_ID           NUMBER          NOT NULL,
    JOB_NAME                VARCHAR2(200)   NOT NULL,
    JOB_DESCRIPTION         VARCHAR2(4000),
    ORACLE_BASE_URL         VARCHAR2(500),
    SOURCE_ENDPOINT         VARCHAR2(1000),
    DESTINATION_ENDPOINT    VARCHAR2(1000),
    ORACLE_USERNAME         VARCHAR2(200),
    ORACLE_PASSWORD         VARCHAR2(500),
    PARAMETERS              CLOB,
    POST_JSON_SAMPLE        CLOB,
    SCHEDULE_STATUS         VARCHAR2(20)    DEFAULT 'INACTIVE',
    SCHEDULE_FREQUENCY      VARCHAR2(20)    DEFAULT 'MANUAL',
    SCHEDULE_START_DATE     DATE,
    SCHEDULE_END_DATE       DATE,
    SCHEDULE_TIME           VARCHAR2(10),
    LAST_RUN_DATE           TIMESTAMP(6),
    NEXT_RUN_DATE           TIMESTAMP(6),
    TOTAL_EXECUTIONS        NUMBER          DEFAULT 0,
    SUCCESS_COUNT           NUMBER          DEFAULT 0,
    FAILURE_COUNT           NUMBER          DEFAULT 0,
    IS_ACTIVE               VARCHAR2(1)     DEFAULT 'Y',
    NOTIFICATION_EMAIL      VARCHAR2(500),
    RETRY_ON_FAILURE        VARCHAR2(1)     DEFAULT 'N',
    MAX_RETRIES             NUMBER          DEFAULT 3,
    CREATED_DATE            TIMESTAMP(6)    DEFAULT SYSTIMESTAMP,
    CREATED_BY              VARCHAR2(100)   DEFAULT USER,
    UPDATED_DATE            TIMESTAMP(6),
    UPDATED_BY              VARCHAR2(100),

    CONSTRAINT RR_SYNC_JOBS_HEADER_PK PRIMARY KEY (SYNC_JOB_ID),
    CONSTRAINT RR_SYNC_JOBS_HEADER_FK1 FOREIGN KEY (JOB_MASTER_ID)
        REFERENCES RR_SYNC_JOBS_MASTER(JOB_MASTER_ID),
    CONSTRAINT RR_SYNC_JOBS_HEADER_CK1 CHECK (SCHEDULE_STATUS IN ('ACTIVE', 'INACTIVE', 'PAUSED')),
    CONSTRAINT RR_SYNC_JOBS_HEADER_CK2 CHECK (SCHEDULE_FREQUENCY IN ('HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'MANUAL')),
    CONSTRAINT RR_SYNC_JOBS_HEADER_CK3 CHECK (IS_ACTIVE IN ('Y', 'N')),
    CONSTRAINT RR_SYNC_JOBS_HEADER_CK4 CHECK (RETRY_ON_FAILURE IN ('Y', 'N'))
);

CREATE SEQUENCE RR_SYNC_JOBS_HEADER_SEQ START WITH 1 INCREMENT BY 1;

-- Indexes for header table
CREATE INDEX RR_SYNC_JH_MASTER_IDX ON RR_SYNC_JOBS_HEADER(JOB_MASTER_ID);
CREATE INDEX RR_SYNC_JH_STATUS_IDX ON RR_SYNC_JOBS_HEADER(SCHEDULE_STATUS);
CREATE INDEX RR_SYNC_JH_ACTIVE_IDX ON RR_SYNC_JOBS_HEADER(IS_ACTIVE);
CREATE INDEX RR_SYNC_JH_NEXT_RUN_IDX ON RR_SYNC_JOBS_HEADER(NEXT_RUN_DATE);
CREATE INDEX RR_SYNC_JH_LAST_RUN_IDX ON RR_SYNC_JOBS_HEADER(LAST_RUN_DATE);

-- Comments for header table
COMMENT ON TABLE RR_SYNC_JOBS_HEADER IS 'Configured sync job instances with schedules';
COMMENT ON COLUMN RR_SYNC_JOBS_HEADER.JOB_NAME IS 'User-friendly name for this job instance';
COMMENT ON COLUMN RR_SYNC_JOBS_HEADER.PARAMETERS IS 'JSON with runtime parameters (filters, dates, etc.)';
COMMENT ON COLUMN RR_SYNC_JOBS_HEADER.POST_JSON_SAMPLE IS 'Sample JSON for testing';
COMMENT ON COLUMN RR_SYNC_JOBS_HEADER.SCHEDULE_TIME IS 'Time in HH24:MI format';

-- =====================================================
-- 3. RR_SYNC_JOBS_DETAILS - Execution History and Logs
-- =====================================================
-- Every time a sync job runs, a new detail record is created
-- Provides complete audit trail and monitoring data

CREATE TABLE RR_SYNC_JOBS_DETAILS (
    EXECUTION_ID            NUMBER          NOT NULL,
    SYNC_JOB_ID             NUMBER          NOT NULL,
    LINE_ID                 NUMBER          NOT NULL,
    START_DATE              DATE            NOT NULL,
    START_TIME              TIMESTAMP(6)    NOT NULL,
    END_DATE                DATE,
    END_TIME                TIMESTAMP(6),
    DURATION_SECONDS        NUMBER,
    FETCHED_RECORDS         NUMBER          DEFAULT 0,
    SYNCED_RECORDS          NUMBER          DEFAULT 0,
    ERROR_RECORDS           NUMBER          DEFAULT 0,
    FETCH_STATUS            VARCHAR2(20),
    SYNC_STATUS             VARCHAR2(20)    DEFAULT 'RUNNING',
    PARAMETERS              CLOB,
    ERROR_MESSAGE           VARCHAR2(4000),
    ERROR_DETAILS           CLOB,
    ORACLE_RESPONSE         CLOB,
    SYNC_RESPONSE           CLOB,
    RETRY_COUNT             NUMBER          DEFAULT 0,
    TRIGGERED_BY            VARCHAR2(20)    DEFAULT 'USER',
    TRIGGERED_BY_USER       VARCHAR2(100)   DEFAULT USER,
    CREATED_DATE            TIMESTAMP(6)    DEFAULT SYSTIMESTAMP,
    CREATED_BY              VARCHAR2(100)   DEFAULT USER,

    CONSTRAINT RR_SYNC_JOBS_DETAILS_PK PRIMARY KEY (EXECUTION_ID),
    CONSTRAINT RR_SYNC_JOBS_DETAILS_FK1 FOREIGN KEY (SYNC_JOB_ID)
        REFERENCES RR_SYNC_JOBS_HEADER(SYNC_JOB_ID),
    CONSTRAINT RR_SYNC_JOBS_DETAILS_CK1 CHECK (FETCH_STATUS IN ('SUCCESS', 'FAILED', 'TIMEOUT')),
    CONSTRAINT RR_SYNC_JOBS_DETAILS_CK2 CHECK (SYNC_STATUS IN ('RUNNING', 'SUCCESS', 'FAILED', 'PARTIAL')),
    CONSTRAINT RR_SYNC_JOBS_DETAILS_CK3 CHECK (TRIGGERED_BY IN ('USER', 'SCHEDULER', 'API', 'RETRY'))
);

CREATE SEQUENCE RR_SYNC_JOBS_DETAILS_SEQ START WITH 1 INCREMENT BY 1;

-- Indexes for details table
CREATE INDEX RR_SYNC_JD_JOB_IDX ON RR_SYNC_JOBS_DETAILS(SYNC_JOB_ID);
CREATE INDEX RR_SYNC_JD_STATUS_IDX ON RR_SYNC_JOBS_DETAILS(SYNC_STATUS);
CREATE INDEX RR_SYNC_JD_START_DATE_IDX ON RR_SYNC_JOBS_DETAILS(START_DATE);
CREATE INDEX RR_SYNC_JD_EXEC_IDX ON RR_SYNC_JOBS_DETAILS(EXECUTION_ID, SYNC_JOB_ID);

-- Comments for details table
COMMENT ON TABLE RR_SYNC_JOBS_DETAILS IS 'Execution history and logs for sync jobs';
COMMENT ON COLUMN RR_SYNC_JOBS_DETAILS.LINE_ID IS 'Sequential line number for ordering';
COMMENT ON COLUMN RR_SYNC_JOBS_DETAILS.DURATION_SECONDS IS 'Calculated: end_time - start_time';
COMMENT ON COLUMN RR_SYNC_JOBS_DETAILS.ORACLE_RESPONSE IS 'Raw JSON response from Oracle Fusion';
COMMENT ON COLUMN RR_SYNC_JOBS_DETAILS.SYNC_RESPONSE IS 'Response from APEX POST handler';

-- =====================================================
-- Insert Sample Master Job for GL Journal Batches
-- =====================================================

INSERT INTO RR_SYNC_JOBS_MASTER (
    JOB_MASTER_ID,
    MODULE,
    JOB_NAME,
    JOB_CODE,
    SOURCE_ENDPOINT,
    DESTINATION_ENDPOINT,
    API_TYPE,
    HTTP_METHOD,
    DESTINATION_PROCEDURE,
    DEFAULT_PARAMETERS,
    DESCRIPTION,
    IS_ACTIVE
) VALUES (
    RR_SYNC_JOBS_MASTER_SEQ.NEXTVAL,
    'GL',
    'Journal Batches',
    'GL_JOURNAL_BATCHES',
    '/fscmRestApi/resources/11.13.18.05/journalBatches',
    '/ords/r/wksp_graysapp/rr/gl/journalbatches',
    'REST',
    'GET',
    'RR_GL_SYNC_JOURNAL_BATCH',
    '{"limit": 500, "offset": 0, "finder": "findByDateRange"}',
    'Sync GL Journal Batches from Oracle Fusion to APEX',
    'Y'
);

COMMIT;

-- =====================================================
-- Verification Queries
-- =====================================================

SELECT 'RR_SYNC_JOBS_MASTER' as table_name, COUNT(*) as record_count FROM RR_SYNC_JOBS_MASTER
UNION ALL
SELECT 'RR_SYNC_JOBS_HEADER', COUNT(*) FROM RR_SYNC_JOBS_HEADER
UNION ALL
SELECT 'RR_SYNC_JOBS_DETAILS', COUNT(*) FROM RR_SYNC_JOBS_DETAILS;

SELECT * FROM RR_SYNC_JOBS_MASTER ORDER BY JOB_MASTER_ID;

PROMPT
PROMPT =====================================================
PROMPT RR Sync Jobs Tables Created Successfully!
PROMPT =====================================================
PROMPT Next Steps:
PROMPT 1. Run 02_rr_sync_jobs_master_handlers.sql
PROMPT 2. Run 03_rr_sync_jobs_header_handlers.sql
PROMPT 3. Run 04_rr_sync_jobs_details_handlers.sql
PROMPT 4. Run 05_rr_sync_jobs_package.sql
PROMPT 5. Run 06_rr_sync_jobs_apex_page.sql
PROMPT =====================================================
