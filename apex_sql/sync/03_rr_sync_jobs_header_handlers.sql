-- =====================================================
-- RR SYNC JOBS HEADER - REST API Handlers
-- Part of Sync Module
-- =====================================================
-- Purpose: Create POST and GET handlers for Sync Jobs Header
-- Author: Claude Code
-- Date: 2025-11-10
-- =====================================================

-- =====================================================
-- 1. CREATE OR UPDATE SYNC JOB HEADER
-- =====================================================

CREATE OR REPLACE PROCEDURE RR_SYNC_JOBS_HEADER_UPSERT (
    p_sync_job_id           IN NUMBER DEFAULT NULL,
    p_job_master_id         IN NUMBER,
    p_job_name              IN VARCHAR2,
    p_job_description       IN VARCHAR2 DEFAULT NULL,
    p_oracle_base_url       IN VARCHAR2 DEFAULT NULL,
    p_source_endpoint       IN VARCHAR2 DEFAULT NULL,
    p_destination_endpoint  IN VARCHAR2 DEFAULT NULL,
    p_oracle_username       IN VARCHAR2 DEFAULT NULL,
    p_oracle_password       IN VARCHAR2 DEFAULT NULL,
    p_parameters            IN CLOB DEFAULT NULL,
    p_post_json_sample      IN CLOB DEFAULT NULL,
    p_schedule_status       IN VARCHAR2 DEFAULT 'INACTIVE',
    p_schedule_frequency    IN VARCHAR2 DEFAULT 'MANUAL',
    p_schedule_start_date   IN DATE DEFAULT NULL,
    p_schedule_end_date     IN DATE DEFAULT NULL,
    p_schedule_time         IN VARCHAR2 DEFAULT NULL,
    p_is_active             IN VARCHAR2 DEFAULT 'Y',
    p_notification_email    IN VARCHAR2 DEFAULT NULL,
    p_retry_on_failure      IN VARCHAR2 DEFAULT 'N',
    p_max_retries           IN NUMBER DEFAULT 3
) AS
    v_sync_job_id NUMBER;
    v_exists NUMBER;
    v_next_run_date TIMESTAMP;
BEGIN
    -- Calculate next run date based on schedule
    IF p_schedule_status = 'ACTIVE' AND p_schedule_frequency != 'MANUAL' THEN
        v_next_run_date := SYSTIMESTAMP; -- Will be properly calculated by scheduler
    END IF;

    -- Check if updating existing record
    IF p_sync_job_id IS NOT NULL THEN
        SELECT COUNT(*) INTO v_exists
        FROM RR_SYNC_JOBS_HEADER
        WHERE SYNC_JOB_ID = p_sync_job_id;

        IF v_exists > 0 THEN
            -- Update existing record
            UPDATE RR_SYNC_JOBS_HEADER
            SET JOB_MASTER_ID = p_job_master_id,
                JOB_NAME = p_job_name,
                JOB_DESCRIPTION = p_job_description,
                ORACLE_BASE_URL = p_oracle_base_url,
                SOURCE_ENDPOINT = p_source_endpoint,
                DESTINATION_ENDPOINT = p_destination_endpoint,
                ORACLE_USERNAME = p_oracle_username,
                ORACLE_PASSWORD = p_oracle_password,
                PARAMETERS = p_parameters,
                POST_JSON_SAMPLE = p_post_json_sample,
                SCHEDULE_STATUS = p_schedule_status,
                SCHEDULE_FREQUENCY = p_schedule_frequency,
                SCHEDULE_START_DATE = p_schedule_start_date,
                SCHEDULE_END_DATE = p_schedule_end_date,
                SCHEDULE_TIME = p_schedule_time,
                NEXT_RUN_DATE = v_next_run_date,
                IS_ACTIVE = p_is_active,
                NOTIFICATION_EMAIL = p_notification_email,
                RETRY_ON_FAILURE = p_retry_on_failure,
                MAX_RETRIES = p_max_retries,
                UPDATED_DATE = SYSTIMESTAMP,
                UPDATED_BY = USER
            WHERE SYNC_JOB_ID = p_sync_job_id;

            v_sync_job_id := p_sync_job_id;

            COMMIT;
            HTP.print('{"status": "SUCCESS", "message": "Sync job updated successfully", "syncJobId": ' || v_sync_job_id || '}');
            RETURN;
        END IF;
    END IF;

    -- Insert new record
    v_sync_job_id := RR_SYNC_JOBS_HEADER_SEQ.NEXTVAL;

    INSERT INTO RR_SYNC_JOBS_HEADER (
        SYNC_JOB_ID,
        JOB_MASTER_ID,
        JOB_NAME,
        JOB_DESCRIPTION,
        ORACLE_BASE_URL,
        SOURCE_ENDPOINT,
        DESTINATION_ENDPOINT,
        ORACLE_USERNAME,
        ORACLE_PASSWORD,
        PARAMETERS,
        POST_JSON_SAMPLE,
        SCHEDULE_STATUS,
        SCHEDULE_FREQUENCY,
        SCHEDULE_START_DATE,
        SCHEDULE_END_DATE,
        SCHEDULE_TIME,
        NEXT_RUN_DATE,
        IS_ACTIVE,
        NOTIFICATION_EMAIL,
        RETRY_ON_FAILURE,
        MAX_RETRIES,
        CREATED_DATE,
        CREATED_BY
    ) VALUES (
        v_sync_job_id,
        p_job_master_id,
        p_job_name,
        p_job_description,
        p_oracle_base_url,
        p_source_endpoint,
        p_destination_endpoint,
        p_oracle_username,
        p_oracle_password,
        p_parameters,
        p_post_json_sample,
        p_schedule_status,
        p_schedule_frequency,
        p_schedule_start_date,
        p_schedule_end_date,
        p_schedule_time,
        v_next_run_date,
        p_is_active,
        p_notification_email,
        p_retry_on_failure,
        p_max_retries,
        SYSTIMESTAMP,
        USER
    );

    COMMIT;

    HTP.print('{"status": "SUCCESS", "message": "Sync job created successfully", "syncJobId": ' || v_sync_job_id || '}');

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.print('{"status": "ERROR", "message": "Error creating sync job: ' || REPLACE(SQLERRM, '"', '\"') || '"}');
END RR_SYNC_JOBS_HEADER_UPSERT;
/

-- =====================================================
-- 2. DEFINE TEMPLATE AND POST HANDLER
-- =====================================================

BEGIN
    -- Define template first
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'rr',
        p_pattern        => 'sync/jobs/header'
    );
    COMMIT;
EXCEPTION
    WHEN OTHERS THEN
        NULL; -- Template might already exist
END;
/

BEGIN
    -- Define POST handler
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'rr',
        p_pattern        => 'sync/jobs/header',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_source         =>
'DECLARE
    v_body CLOB;
BEGIN
    v_body := :body_text;

    RR_SYNC_JOBS_HEADER_UPSERT(
        p_sync_job_id           => JSON_VALUE(v_body, ''$.syncJobId''),
        p_job_master_id         => JSON_VALUE(v_body, ''$.jobMasterId''),
        p_job_name              => JSON_VALUE(v_body, ''$.jobName''),
        p_job_description       => JSON_VALUE(v_body, ''$.jobDescription''),
        p_oracle_base_url       => JSON_VALUE(v_body, ''$.oracleBaseUrl''),
        p_source_endpoint       => JSON_VALUE(v_body, ''$.sourceEndpoint''),
        p_destination_endpoint  => JSON_VALUE(v_body, ''$.destinationEndpoint''),
        p_oracle_username       => JSON_VALUE(v_body, ''$.oracleUsername''),
        p_oracle_password       => JSON_VALUE(v_body, ''$.oraclePassword''),
        p_parameters            => JSON_VALUE(v_body, ''$.parameters''),
        p_post_json_sample      => JSON_VALUE(v_body, ''$.postJsonSample''),
        p_schedule_status       => JSON_VALUE(v_body, ''$.scheduleStatus''),
        p_schedule_frequency    => JSON_VALUE(v_body, ''$.scheduleFrequency''),
        p_schedule_start_date   => TO_DATE(JSON_VALUE(v_body, ''$.scheduleStartDate''), ''YYYY-MM-DD''),
        p_schedule_end_date     => TO_DATE(JSON_VALUE(v_body, ''$.scheduleEndDate''), ''YYYY-MM-DD''),
        p_schedule_time         => JSON_VALUE(v_body, ''$.scheduleTime''),
        p_is_active             => JSON_VALUE(v_body, ''$.isActive''),
        p_notification_email    => JSON_VALUE(v_body, ''$.notificationEmail''),
        p_retry_on_failure      => JSON_VALUE(v_body, ''$.retryOnFailure''),
        p_max_retries           => JSON_VALUE(v_body, ''$.maxRetries'')
    );
END;'
    );
    COMMIT;
END;
/

-- =====================================================
-- 3. GET ALL SYNC JOB HEADERS (with filters)
-- =====================================================

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'rr',
        p_pattern        => 'sync/jobs/header',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_query,
        p_source         =>
'SELECT
    h.SYNC_JOB_ID as "syncJobId",
    h.JOB_MASTER_ID as "jobMasterId",
    m.MODULE as "module",
    m.JOB_NAME as "masterJobName",
    h.JOB_NAME as "jobName",
    h.JOB_DESCRIPTION as "jobDescription",
    h.ORACLE_BASE_URL as "oracleBaseUrl",
    h.SOURCE_ENDPOINT as "sourceEndpoint",
    h.DESTINATION_ENDPOINT as "destinationEndpoint",
    h.ORACLE_USERNAME as "oracleUsername",
    h.PARAMETERS as "parameters",
    h.POST_JSON_SAMPLE as "postJsonSample",
    h.SCHEDULE_STATUS as "scheduleStatus",
    h.SCHEDULE_FREQUENCY as "scheduleFrequency",
    TO_CHAR(h.SCHEDULE_START_DATE, ''YYYY-MM-DD'') as "scheduleStartDate",
    TO_CHAR(h.SCHEDULE_END_DATE, ''YYYY-MM-DD'') as "scheduleEndDate",
    h.SCHEDULE_TIME as "scheduleTime",
    TO_CHAR(h.LAST_RUN_DATE, ''YYYY-MM-DD"T"HH24:MI:SS'') as "lastRunDate",
    TO_CHAR(h.NEXT_RUN_DATE, ''YYYY-MM-DD"T"HH24:MI:SS'') as "nextRunDate",
    h.TOTAL_EXECUTIONS as "totalExecutions",
    h.SUCCESS_COUNT as "successCount",
    h.FAILURE_COUNT as "failureCount",
    h.IS_ACTIVE as "isActive",
    h.NOTIFICATION_EMAIL as "notificationEmail",
    h.RETRY_ON_FAILURE as "retryOnFailure",
    h.MAX_RETRIES as "maxRetries",
    TO_CHAR(h.CREATED_DATE, ''YYYY-MM-DD"T"HH24:MI:SS'') as "createdDate",
    h.CREATED_BY as "createdBy",
    TO_CHAR(h.UPDATED_DATE, ''YYYY-MM-DD"T"HH24:MI:SS'') as "updatedDate",
    h.UPDATED_BY as "updatedBy"
FROM RR_SYNC_JOBS_HEADER h
JOIN RR_SYNC_JOBS_MASTER m ON h.JOB_MASTER_ID = m.JOB_MASTER_ID
WHERE 1=1
    AND (:module IS NULL OR m.MODULE = :module)
    AND (:schedule_status IS NULL OR h.SCHEDULE_STATUS = :schedule_status)
    AND (:is_active IS NULL OR h.IS_ACTIVE = :is_active)
    AND (:search IS NULL OR
         UPPER(h.JOB_NAME) LIKE UPPER(''%'' || :search || ''%'') OR
         UPPER(h.JOB_DESCRIPTION) LIKE UPPER(''%'' || :search || ''%''))
ORDER BY h.CREATED_DATE DESC
OFFSET NVL(:offset, 0) ROWS
FETCH NEXT NVL(:limit, 100) ROWS ONLY'
    );
    COMMIT;
END;
/

-- =====================================================
-- 4. GET SYNC JOB HEADER BY ID
-- =====================================================

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'rr',
        p_pattern        => 'sync/jobs/header/:id'
    );
    COMMIT;
EXCEPTION
    WHEN OTHERS THEN
        NULL; -- Template might already exist
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'rr',
        p_pattern        => 'sync/jobs/header/:id',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_query,
        p_source         =>
'SELECT
    h.SYNC_JOB_ID as "syncJobId",
    h.JOB_MASTER_ID as "jobMasterId",
    m.MODULE as "module",
    m.JOB_NAME as "masterJobName",
    m.JOB_CODE as "jobCode",
    h.JOB_NAME as "jobName",
    h.JOB_DESCRIPTION as "jobDescription",
    h.ORACLE_BASE_URL as "oracleBaseUrl",
    h.SOURCE_ENDPOINT as "sourceEndpoint",
    h.DESTINATION_ENDPOINT as "destinationEndpoint",
    h.ORACLE_USERNAME as "oracleUsername",
    h.ORACLE_PASSWORD as "oraclePassword",
    h.PARAMETERS as "parameters",
    h.POST_JSON_SAMPLE as "postJsonSample",
    h.SCHEDULE_STATUS as "scheduleStatus",
    h.SCHEDULE_FREQUENCY as "scheduleFrequency",
    TO_CHAR(h.SCHEDULE_START_DATE, ''YYYY-MM-DD'') as "scheduleStartDate",
    TO_CHAR(h.SCHEDULE_END_DATE, ''YYYY-MM-DD'') as "scheduleEndDate",
    h.SCHEDULE_TIME as "scheduleTime",
    TO_CHAR(h.LAST_RUN_DATE, ''YYYY-MM-DD"T"HH24:MI:SS'') as "lastRunDate",
    TO_CHAR(h.NEXT_RUN_DATE, ''YYYY-MM-DD"T"HH24:MI:SS'') as "nextRunDate",
    h.TOTAL_EXECUTIONS as "totalExecutions",
    h.SUCCESS_COUNT as "successCount",
    h.FAILURE_COUNT as "failureCount",
    h.IS_ACTIVE as "isActive",
    h.NOTIFICATION_EMAIL as "notificationEmail",
    h.RETRY_ON_FAILURE as "retryOnFailure",
    h.MAX_RETRIES as "maxRetries",
    TO_CHAR(h.CREATED_DATE, ''YYYY-MM-DD"T"HH24:MI:SS'') as "createdDate",
    h.CREATED_BY as "createdBy",
    TO_CHAR(h.UPDATED_DATE, ''YYYY-MM-DD"T"HH24:MI:SS'') as "updatedDate",
    h.UPDATED_BY as "updatedBy"
FROM RR_SYNC_JOBS_HEADER h
JOIN RR_SYNC_JOBS_MASTER m ON h.JOB_MASTER_ID = m.JOB_MASTER_ID
WHERE h.SYNC_JOB_ID = :id'
    );
    COMMIT;
END;
/

-- =====================================================
-- 5. GET JOBS DUE FOR EXECUTION
-- =====================================================

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'rr',
        p_pattern        => 'sync/jobs/header/due'
    );
    COMMIT;
EXCEPTION
    WHEN OTHERS THEN
        NULL; -- Template might already exist
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'rr',
        p_pattern        => 'sync/jobs/header/due',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_query,
        p_source         =>
'SELECT
    h.SYNC_JOB_ID as "syncJobId",
    h.JOB_NAME as "jobName",
    m.MODULE as "module",
    m.JOB_CODE as "jobCode",
    TO_CHAR(h.NEXT_RUN_DATE, ''YYYY-MM-DD"T"HH24:MI:SS'') as "nextRunDate"
FROM RR_SYNC_JOBS_HEADER h
JOIN RR_SYNC_JOBS_MASTER m ON h.JOB_MASTER_ID = m.JOB_MASTER_ID
WHERE h.SCHEDULE_STATUS = ''ACTIVE''
    AND h.IS_ACTIVE = ''Y''
    AND h.NEXT_RUN_DATE <= SYSTIMESTAMP
    AND (h.SCHEDULE_END_DATE IS NULL OR h.SCHEDULE_END_DATE >= SYSDATE)
ORDER BY h.NEXT_RUN_DATE'
    );
    COMMIT;
END;
/

PROMPT
PROMPT =====================================================
PROMPT RR Sync Jobs Header Handlers Created Successfully!
PROMPT =====================================================
PROMPT
PROMPT Available Endpoints:
PROMPT POST   /ords/r/wksp_graysapp/rr/sync/jobs/header
PROMPT GET    /ords/r/wksp_graysapp/rr/sync/jobs/header?module=GL&schedule_status=ACTIVE
PROMPT GET    /ords/r/wksp_graysapp/rr/sync/jobs/header/:id
PROMPT GET    /ords/r/wksp_graysapp/rr/sync/jobs/header/due
PROMPT
PROMPT Test POST Request:
PROMPT {
PROMPT   "jobMasterId": 1,
PROMPT   "jobName": "Daily GL Sync May-23",
PROMPT   "jobDescription": "Sync GL batches for May 2023",
PROMPT   "oracleBaseUrl": "https://efmh.fa.em3.oraclecloud.com",
PROMPT   "parameters": "{\"period_name\": \"May-23\"}",
PROMPT   "scheduleStatus": "ACTIVE",
PROMPT   "scheduleFrequency": "DAILY",
PROMPT   "scheduleTime": "02:00",
PROMPT   "isActive": "Y"
PROMPT }
PROMPT =====================================================
