-- =====================================================
-- RR SYNC JOBS DETAILS - REST API Handlers
-- Part of Sync Module
-- =====================================================
-- Purpose: Create POST and GET handlers for Sync Jobs Details/Logs
-- Author: Claude Code
-- Date: 2025-11-10
-- =====================================================

-- =====================================================
-- 1. CREATE EXECUTION LOG ENTRY
-- =====================================================

CREATE OR REPLACE PROCEDURE RR_SYNC_JOBS_DETAILS_CREATE (
    p_sync_job_id           IN NUMBER,
    p_parameters            IN CLOB DEFAULT NULL,
    p_triggered_by          IN VARCHAR2 DEFAULT 'USER',
    p_execution_id          OUT NUMBER
) AS
    v_line_id NUMBER;
BEGIN
    -- Get next line ID for this job
    SELECT NVL(MAX(LINE_ID), 0) + 1
    INTO v_line_id
    FROM RR_SYNC_JOBS_DETAILS
    WHERE SYNC_JOB_ID = p_sync_job_id;

    -- Create new execution record
    p_execution_id := RR_SYNC_JOBS_DETAILS_SEQ.NEXTVAL;

    INSERT INTO RR_SYNC_JOBS_DETAILS (
        EXECUTION_ID,
        SYNC_JOB_ID,
        LINE_ID,
        START_DATE,
        START_TIME,
        SYNC_STATUS,
        PARAMETERS,
        TRIGGERED_BY,
        TRIGGERED_BY_USER,
        CREATED_DATE,
        CREATED_BY
    ) VALUES (
        p_execution_id,
        p_sync_job_id,
        v_line_id,
        SYSDATE,
        SYSTIMESTAMP,
        'RUNNING',
        p_parameters,
        p_triggered_by,
        USER,
        SYSTIMESTAMP,
        USER
    );

    COMMIT;

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        RAISE;
END RR_SYNC_JOBS_DETAILS_CREATE;
/

-- =====================================================
-- 2. UPDATE EXECUTION LOG ENTRY
-- =====================================================

CREATE OR REPLACE PROCEDURE RR_SYNC_JOBS_DETAILS_UPDATE (
    p_execution_id          IN NUMBER,
    p_fetched_records       IN NUMBER DEFAULT NULL,
    p_synced_records        IN NUMBER DEFAULT NULL,
    p_error_records         IN NUMBER DEFAULT NULL,
    p_fetch_status          IN VARCHAR2 DEFAULT NULL,
    p_sync_status           IN VARCHAR2 DEFAULT NULL,
    p_error_message         IN VARCHAR2 DEFAULT NULL,
    p_error_details         IN CLOB DEFAULT NULL,
    p_oracle_response       IN CLOB DEFAULT NULL,
    p_sync_response         IN CLOB DEFAULT NULL,
    p_retry_count           IN NUMBER DEFAULT NULL
) AS
    v_start_time TIMESTAMP;
    v_duration NUMBER;
BEGIN
    -- Get start time to calculate duration
    SELECT START_TIME INTO v_start_time
    FROM RR_SYNC_JOBS_DETAILS
    WHERE EXECUTION_ID = p_execution_id;

    v_duration := EXTRACT(DAY FROM (SYSTIMESTAMP - v_start_time)) * 86400 +
                  EXTRACT(HOUR FROM (SYSTIMESTAMP - v_start_time)) * 3600 +
                  EXTRACT(MINUTE FROM (SYSTIMESTAMP - v_start_time)) * 60 +
                  EXTRACT(SECOND FROM (SYSTIMESTAMP - v_start_time));

    UPDATE RR_SYNC_JOBS_DETAILS
    SET END_DATE = SYSDATE,
        END_TIME = SYSTIMESTAMP,
        DURATION_SECONDS = v_duration,
        FETCHED_RECORDS = NVL(p_fetched_records, FETCHED_RECORDS),
        SYNCED_RECORDS = NVL(p_synced_records, SYNCED_RECORDS),
        ERROR_RECORDS = NVL(p_error_records, ERROR_RECORDS),
        FETCH_STATUS = NVL(p_fetch_status, FETCH_STATUS),
        SYNC_STATUS = NVL(p_sync_status, SYNC_STATUS),
        ERROR_MESSAGE = NVL(p_error_message, ERROR_MESSAGE),
        ERROR_DETAILS = NVL(p_error_details, ERROR_DETAILS),
        ORACLE_RESPONSE = NVL(p_oracle_response, ORACLE_RESPONSE),
        SYNC_RESPONSE = NVL(p_sync_response, SYNC_RESPONSE),
        RETRY_COUNT = NVL(p_retry_count, RETRY_COUNT)
    WHERE EXECUTION_ID = p_execution_id;

    COMMIT;

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        RAISE;
END RR_SYNC_JOBS_DETAILS_UPDATE;
/

-- =====================================================
-- 3. DEFINE POST HANDLER (Create Execution)
-- =====================================================

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'rr',
        p_pattern        => 'sync/jobs/details',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_source         =>
'DECLARE
    v_body CLOB;
    v_execution_id NUMBER;
BEGIN
    v_body := :body_text;

    RR_SYNC_JOBS_DETAILS_CREATE(
        p_sync_job_id  => JSON_VALUE(v_body, ''$.syncJobId''),
        p_parameters   => JSON_VALUE(v_body, ''$.parameters''),
        p_triggered_by => JSON_VALUE(v_body, ''$.triggeredBy''),
        p_execution_id => v_execution_id
    );

    HTP.print(''{"status": "SUCCESS", "message": "Execution log created", "executionId": '' || v_execution_id || ''}'');

EXCEPTION
    WHEN OTHERS THEN
        HTP.print(''{"status": "ERROR", "message": "Error creating execution log: '' || REPLACE(SQLERRM, ''"'', ''\\"'') || ''"}'');
END;'
    );
    COMMIT;
END;
/

-- =====================================================
-- 4. DEFINE PUT HANDLER (Update Execution)
-- =====================================================

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'rr',
        p_pattern        => 'sync/jobs/details/:id'
    );

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'rr',
        p_pattern        => 'sync/jobs/details/:id',
        p_method         => 'PUT',
        p_source_type    => ORDS.source_type_plsql,
        p_source         =>
'DECLARE
    v_body CLOB;
BEGIN
    v_body := :body_text;

    RR_SYNC_JOBS_DETAILS_UPDATE(
        p_execution_id     => :id,
        p_fetched_records  => JSON_VALUE(v_body, ''$.fetchedRecords''),
        p_synced_records   => JSON_VALUE(v_body, ''$.syncedRecords''),
        p_error_records    => JSON_VALUE(v_body, ''$.errorRecords''),
        p_fetch_status     => JSON_VALUE(v_body, ''$.fetchStatus''),
        p_sync_status      => JSON_VALUE(v_body, ''$.syncStatus''),
        p_error_message    => JSON_VALUE(v_body, ''$.errorMessage''),
        p_error_details    => JSON_VALUE(v_body, ''$.errorDetails''),
        p_oracle_response  => JSON_VALUE(v_body, ''$.oracleResponse''),
        p_sync_response    => JSON_VALUE(v_body, ''$.syncResponse''),
        p_retry_count      => JSON_VALUE(v_body, ''$.retryCount'')
    );

    HTP.print(''{"status": "SUCCESS", "message": "Execution log updated"}'');

EXCEPTION
    WHEN OTHERS THEN
        HTP.print(''{"status": "ERROR", "message": "Error updating execution log: '' || REPLACE(SQLERRM, ''"'', ''\\"'') || ''"}'');
END;'
    );
    COMMIT;
END;
/

-- =====================================================
-- 5. GET ALL EXECUTION LOGS (with filters)
-- =====================================================

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'rr',
        p_pattern        => 'sync/jobs/details',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_query,
        p_source         =>
'SELECT
    d.EXECUTION_ID as "executionId",
    d.SYNC_JOB_ID as "syncJobId",
    h.JOB_NAME as "jobName",
    m.MODULE as "module",
    m.JOB_CODE as "jobCode",
    d.LINE_ID as "lineId",
    TO_CHAR(d.START_DATE, ''YYYY-MM-DD'') as "startDate",
    TO_CHAR(d.START_TIME, ''YYYY-MM-DD"T"HH24:MI:SS'') as "startTime",
    TO_CHAR(d.END_DATE, ''YYYY-MM-DD'') as "endDate",
    TO_CHAR(d.END_TIME, ''YYYY-MM-DD"T"HH24:MI:SS'') as "endTime",
    d.DURATION_SECONDS as "durationSeconds",
    d.FETCHED_RECORDS as "fetchedRecords",
    d.SYNCED_RECORDS as "syncedRecords",
    d.ERROR_RECORDS as "errorRecords",
    d.FETCH_STATUS as "fetchStatus",
    d.SYNC_STATUS as "syncStatus",
    d.ERROR_MESSAGE as "errorMessage",
    d.RETRY_COUNT as "retryCount",
    d.TRIGGERED_BY as "triggeredBy",
    d.TRIGGERED_BY_USER as "triggeredByUser"
FROM RR_SYNC_JOBS_DETAILS d
JOIN RR_SYNC_JOBS_HEADER h ON d.SYNC_JOB_ID = h.SYNC_JOB_ID
JOIN RR_SYNC_JOBS_MASTER m ON h.JOB_MASTER_ID = m.JOB_MASTER_ID
WHERE 1=1
    AND (:sync_job_id IS NULL OR d.SYNC_JOB_ID = :sync_job_id)
    AND (:sync_status IS NULL OR d.SYNC_STATUS = :sync_status)
    AND (:module IS NULL OR m.MODULE = :module)
    AND (:start_date IS NULL OR d.START_DATE >= TO_DATE(:start_date, ''YYYY-MM-DD''))
    AND (:end_date IS NULL OR d.START_DATE <= TO_DATE(:end_date, ''YYYY-MM-DD''))
ORDER BY d.START_TIME DESC
OFFSET NVL(:offset, 0) ROWS
FETCH NEXT NVL(:limit, 100) ROWS ONLY'
    );
    COMMIT;
END;
/

-- =====================================================
-- 6. GET EXECUTION LOG BY ID (with full details)
-- =====================================================

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'rr',
        p_pattern        => 'sync/jobs/details/:id',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_query,
        p_source         =>
'SELECT
    d.EXECUTION_ID as "executionId",
    d.SYNC_JOB_ID as "syncJobId",
    h.JOB_NAME as "jobName",
    m.MODULE as "module",
    m.JOB_CODE as "jobCode",
    d.LINE_ID as "lineId",
    TO_CHAR(d.START_DATE, ''YYYY-MM-DD'') as "startDate",
    TO_CHAR(d.START_TIME, ''YYYY-MM-DD"T"HH24:MI:SS'') as "startTime",
    TO_CHAR(d.END_DATE, ''YYYY-MM-DD'') as "endDate",
    TO_CHAR(d.END_TIME, ''YYYY-MM-DD"T"HH24:MI:SS'') as "endTime",
    d.DURATION_SECONDS as "durationSeconds",
    d.FETCHED_RECORDS as "fetchedRecords",
    d.SYNCED_RECORDS as "syncedRecords",
    d.ERROR_RECORDS as "errorRecords",
    d.FETCH_STATUS as "fetchStatus",
    d.SYNC_STATUS as "syncStatus",
    d.PARAMETERS as "parameters",
    d.ERROR_MESSAGE as "errorMessage",
    d.ERROR_DETAILS as "errorDetails",
    d.ORACLE_RESPONSE as "oracleResponse",
    d.SYNC_RESPONSE as "syncResponse",
    d.RETRY_COUNT as "retryCount",
    d.TRIGGERED_BY as "triggeredBy",
    d.TRIGGERED_BY_USER as "triggeredByUser",
    TO_CHAR(d.CREATED_DATE, ''YYYY-MM-DD"T"HH24:MI:SS'') as "createdDate"
FROM RR_SYNC_JOBS_DETAILS d
JOIN RR_SYNC_JOBS_HEADER h ON d.SYNC_JOB_ID = h.SYNC_JOB_ID
JOIN RR_SYNC_JOBS_MASTER m ON h.JOB_MASTER_ID = m.JOB_MASTER_ID
WHERE d.EXECUTION_ID = :id'
    );
    COMMIT;
END;
/

-- =====================================================
-- 7. GET EXECUTION STATISTICS BY JOB
-- =====================================================

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'rr',
        p_pattern        => 'sync/jobs/details/stats',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_query,
        p_source         =>
'SELECT
    d.SYNC_JOB_ID as "syncJobId",
    h.JOB_NAME as "jobName",
    m.MODULE as "module",
    COUNT(*) as "totalExecutions",
    SUM(CASE WHEN d.SYNC_STATUS = ''SUCCESS'' THEN 1 ELSE 0 END) as "successCount",
    SUM(CASE WHEN d.SYNC_STATUS = ''FAILED'' THEN 1 ELSE 0 END) as "failureCount",
    SUM(CASE WHEN d.SYNC_STATUS = ''RUNNING'' THEN 1 ELSE 0 END) as "runningCount",
    SUM(NVL(d.FETCHED_RECORDS, 0)) as "totalFetched",
    SUM(NVL(d.SYNCED_RECORDS, 0)) as "totalSynced",
    SUM(NVL(d.ERROR_RECORDS, 0)) as "totalErrors",
    AVG(d.DURATION_SECONDS) as "avgDuration",
    TO_CHAR(MAX(d.START_TIME), ''YYYY-MM-DD"T"HH24:MI:SS'') as "lastExecutionTime"
FROM RR_SYNC_JOBS_DETAILS d
JOIN RR_SYNC_JOBS_HEADER h ON d.SYNC_JOB_ID = h.SYNC_JOB_ID
JOIN RR_SYNC_JOBS_MASTER m ON h.JOB_MASTER_ID = m.JOB_MASTER_ID
WHERE (:sync_job_id IS NULL OR d.SYNC_JOB_ID = :sync_job_id)
    AND (:module IS NULL OR m.MODULE = :module)
GROUP BY d.SYNC_JOB_ID, h.JOB_NAME, m.MODULE
ORDER BY MAX(d.START_TIME) DESC'
    );
    COMMIT;
END;
/

PROMPT
PROMPT =====================================================
PROMPT RR Sync Jobs Details Handlers Created Successfully!
PROMPT =====================================================
PROMPT
PROMPT Available Endpoints:
PROMPT POST   /ords/r/wksp_graysapp/rr/sync/jobs/details
PROMPT PUT    /ords/r/wksp_graysapp/rr/sync/jobs/details/:id
PROMPT GET    /ords/r/wksp_graysapp/rr/sync/jobs/details?sync_job_id=1&sync_status=SUCCESS
PROMPT GET    /ords/r/wksp_graysapp/rr/sync/jobs/details/:id
PROMPT GET    /ords/r/wksp_graysapp/rr/sync/jobs/details/stats?sync_job_id=1
PROMPT
PROMPT Test POST Request (Create Execution):
PROMPT {
PROMPT   "syncJobId": 1,
PROMPT   "parameters": "{\"period_name\": \"May-23\"}",
PROMPT   "triggeredBy": "USER"
PROMPT }
PROMPT
PROMPT Test PUT Request (Update Execution):
PROMPT {
PROMPT   "fetchedRecords": 100,
PROMPT   "syncedRecords": 95,
PROMPT   "errorRecords": 5,
PROMPT   "fetchStatus": "SUCCESS",
PROMPT   "syncStatus": "SUCCESS"
PROMPT }
PROMPT =====================================================
