-- =====================================================
-- RR SYNC JOBS PACKAGE - Job Execution Logic
-- Part of Sync Module
-- =====================================================
-- Purpose: Main package for executing and managing sync jobs
-- Author: Claude Code
-- Date: 2025-11-10
-- =====================================================

CREATE OR REPLACE PACKAGE RR_SYNC_JOBS_PKG AS

    -- Execute a sync job manually
    PROCEDURE EXECUTE_SYNC_JOB(
        p_sync_job_id IN NUMBER,
        p_triggered_by IN VARCHAR2 DEFAULT 'USER'
    );

    -- Execute all due sync jobs (called by scheduler)
    PROCEDURE EXECUTE_DUE_JOBS;

    -- Calculate next run date for a job
    PROCEDURE CALCULATE_NEXT_RUN(
        p_sync_job_id IN NUMBER
    );

    -- Get job execution summary
    FUNCTION GET_JOB_SUMMARY(
        p_sync_job_id IN NUMBER
    ) RETURN CLOB;

    -- Get overall sync statistics
    FUNCTION GET_SYNC_STATISTICS(
        p_module IN VARCHAR2 DEFAULT NULL
    ) RETURN CLOB;

END RR_SYNC_JOBS_PKG;
/

CREATE OR REPLACE PACKAGE BODY RR_SYNC_JOBS_PKG AS

    -- =====================================================
    -- Private Helper Functions
    -- =====================================================

    -- Make HTTP request to Oracle Fusion
    FUNCTION FETCH_FROM_ORACLE(
        p_base_url IN VARCHAR2,
        p_endpoint IN VARCHAR2,
        p_username IN VARCHAR2,
        p_password IN VARCHAR2,
        p_parameters IN CLOB
    ) RETURN CLOB IS
        v_url VARCHAR2(4000);
        v_response CLOB;
        v_http_request UTL_HTTP.req;
        v_http_response UTL_HTTP.resp;
        v_buffer VARCHAR2(32767);
        v_auth_string VARCHAR2(1000);
    BEGIN
        -- Build URL with parameters
        v_url := p_base_url || p_endpoint;

        -- Add query parameters if provided
        IF p_parameters IS NOT NULL THEN
            -- Simple parameter parsing (in production, use proper JSON parsing)
            v_url := v_url || '?limit=500';
        END IF;

        -- Initialize HTTP request
        v_http_request := UTL_HTTP.BEGIN_REQUEST(v_url, 'GET');

        -- Set authentication header
        v_auth_string := UTL_RAW.CAST_TO_VARCHAR2(
            UTL_ENCODE.BASE64_ENCODE(
                UTL_RAW.CAST_TO_RAW(p_username || ':' || p_password)
            )
        );
        UTL_HTTP.SET_HEADER(v_http_request, 'Authorization', 'Basic ' || v_auth_string);
        UTL_HTTP.SET_HEADER(v_http_request, 'Accept', 'application/json');

        -- Get response
        v_http_response := UTL_HTTP.GET_RESPONSE(v_http_request);

        -- Read response body
        DBMS_LOB.CREATETEMPORARY(v_response, TRUE);
        BEGIN
            LOOP
                UTL_HTTP.READ_TEXT(v_http_response, v_buffer, 32767);
                DBMS_LOB.WRITEAPPEND(v_response, LENGTH(v_buffer), v_buffer);
            END LOOP;
        EXCEPTION
            WHEN UTL_HTTP.END_OF_BODY THEN
                NULL;
        END;

        UTL_HTTP.END_RESPONSE(v_http_response);

        RETURN v_response;

    EXCEPTION
        WHEN OTHERS THEN
            IF v_http_response.status_code IS NOT NULL THEN
                UTL_HTTP.END_RESPONSE(v_http_response);
            END IF;
            RAISE;
    END FETCH_FROM_ORACLE;

    -- Post data to APEX endpoint
    FUNCTION POST_TO_APEX(
        p_endpoint IN VARCHAR2,
        p_data IN CLOB
    ) RETURN CLOB IS
        v_http_request UTL_HTTP.req;
        v_http_response UTL_HTTP.resp;
        v_response CLOB;
        v_buffer VARCHAR2(32767);
        v_offset INTEGER := 1;
        v_amount INTEGER := 32767;
        v_data_chunk VARCHAR2(32767);
    BEGIN
        -- Initialize HTTP POST request
        v_http_request := UTL_HTTP.BEGIN_REQUEST(p_endpoint, 'POST');
        UTL_HTTP.SET_HEADER(v_http_request, 'Content-Type', 'application/json');
        UTL_HTTP.SET_HEADER(v_http_request, 'Content-Length', LENGTH(p_data));

        -- Write request body in chunks
        WHILE v_offset <= DBMS_LOB.GETLENGTH(p_data) LOOP
            v_data_chunk := DBMS_LOB.SUBSTR(p_data, v_amount, v_offset);
            UTL_HTTP.WRITE_TEXT(v_http_request, v_data_chunk);
            v_offset := v_offset + v_amount;
        END LOOP;

        -- Get response
        v_http_response := UTL_HTTP.GET_RESPONSE(v_http_request);

        -- Read response body
        DBMS_LOB.CREATETEMPORARY(v_response, TRUE);
        BEGIN
            LOOP
                UTL_HTTP.READ_TEXT(v_http_response, v_buffer, 32767);
                DBMS_LOB.WRITEAPPEND(v_response, LENGTH(v_buffer), v_buffer);
            END LOOP;
        EXCEPTION
            WHEN UTL_HTTP.END_OF_BODY THEN
                NULL;
        END;

        UTL_HTTP.END_RESPONSE(v_http_response);

        RETURN v_response;

    EXCEPTION
        WHEN OTHERS THEN
            IF v_http_response.status_code IS NOT NULL THEN
                UTL_HTTP.END_RESPONSE(v_http_response);
            END IF;
            RAISE;
    END POST_TO_APEX;

    -- =====================================================
    -- CALCULATE_NEXT_RUN - Calculate when job should run next
    -- =====================================================

    PROCEDURE CALCULATE_NEXT_RUN(
        p_sync_job_id IN NUMBER
    ) IS
        v_frequency VARCHAR2(20);
        v_schedule_time VARCHAR2(10);
        v_last_run TIMESTAMP;
        v_next_run TIMESTAMP;
        v_schedule_end_date DATE;
    BEGIN
        SELECT
            SCHEDULE_FREQUENCY,
            SCHEDULE_TIME,
            LAST_RUN_DATE,
            SCHEDULE_END_DATE
        INTO
            v_frequency,
            v_schedule_time,
            v_last_run,
            v_schedule_end_date
        FROM RR_SYNC_JOBS_HEADER
        WHERE SYNC_JOB_ID = p_sync_job_id
            AND SCHEDULE_STATUS = 'ACTIVE';

        -- Calculate based on frequency
        CASE v_frequency
            WHEN 'HOURLY' THEN
                v_next_run := NVL(v_last_run, SYSTIMESTAMP) + INTERVAL '1' HOUR;

            WHEN 'DAILY' THEN
                v_next_run := TRUNC(NVL(v_last_run, SYSDATE)) + 1;
                IF v_schedule_time IS NOT NULL THEN
                    v_next_run := TO_TIMESTAMP(
                        TO_CHAR(v_next_run, 'YYYY-MM-DD') || ' ' || v_schedule_time,
                        'YYYY-MM-DD HH24:MI'
                    );
                END IF;

            WHEN 'WEEKLY' THEN
                v_next_run := NVL(v_last_run, SYSTIMESTAMP) + INTERVAL '7' DAY;
                IF v_schedule_time IS NOT NULL THEN
                    v_next_run := TO_TIMESTAMP(
                        TO_CHAR(v_next_run, 'YYYY-MM-DD') || ' ' || v_schedule_time,
                        'YYYY-MM-DD HH24:MI'
                    );
                END IF;

            WHEN 'MONTHLY' THEN
                v_next_run := ADD_MONTHS(NVL(v_last_run, SYSDATE), 1);
                IF v_schedule_time IS NOT NULL THEN
                    v_next_run := TO_TIMESTAMP(
                        TO_CHAR(v_next_run, 'YYYY-MM-DD') || ' ' || v_schedule_time,
                        'YYYY-MM-DD HH24:MI'
                    );
                END IF;

            ELSE
                v_next_run := NULL; -- Manual jobs don't have next run
        END CASE;

        -- Don't set next run if past end date
        IF v_schedule_end_date IS NOT NULL AND v_next_run > v_schedule_end_date THEN
            v_next_run := NULL;
        END IF;

        -- Update header
        UPDATE RR_SYNC_JOBS_HEADER
        SET NEXT_RUN_DATE = v_next_run
        WHERE SYNC_JOB_ID = p_sync_job_id;

        COMMIT;

    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            NULL; -- Job not active or doesn't exist
        WHEN OTHERS THEN
            ROLLBACK;
            RAISE;
    END CALCULATE_NEXT_RUN;

    -- =====================================================
    -- EXECUTE_SYNC_JOB - Main job execution procedure
    -- =====================================================

    PROCEDURE EXECUTE_SYNC_JOB(
        p_sync_job_id IN NUMBER,
        p_triggered_by IN VARCHAR2 DEFAULT 'USER'
    ) IS
        v_execution_id NUMBER;
        v_job_master_id NUMBER;
        v_oracle_base_url VARCHAR2(500);
        v_source_endpoint VARCHAR2(1000);
        v_destination_endpoint VARCHAR2(1000);
        v_oracle_username VARCHAR2(200);
        v_oracle_password VARCHAR2(500);
        v_parameters CLOB;
        v_retry_on_failure VARCHAR2(1);
        v_max_retries NUMBER;
        v_oracle_response CLOB;
        v_sync_response CLOB;
        v_fetched_records NUMBER := 0;
        v_synced_records NUMBER := 0;
        v_error_records NUMBER := 0;
        v_fetch_status VARCHAR2(20);
        v_sync_status VARCHAR2(20);
        v_error_message VARCHAR2(4000);
        v_error_details CLOB;
        v_retry_count NUMBER := 0;
    BEGIN
        -- Get job configuration
        SELECT
            h.JOB_MASTER_ID,
            h.ORACLE_BASE_URL,
            COALESCE(h.SOURCE_ENDPOINT, m.SOURCE_ENDPOINT),
            COALESCE(h.DESTINATION_ENDPOINT, m.DESTINATION_ENDPOINT),
            h.ORACLE_USERNAME,
            h.ORACLE_PASSWORD,
            h.PARAMETERS,
            h.RETRY_ON_FAILURE,
            h.MAX_RETRIES
        INTO
            v_job_master_id,
            v_oracle_base_url,
            v_source_endpoint,
            v_destination_endpoint,
            v_oracle_username,
            v_oracle_password,
            v_parameters,
            v_retry_on_failure,
            v_max_retries
        FROM RR_SYNC_JOBS_HEADER h
        JOIN RR_SYNC_JOBS_MASTER m ON h.JOB_MASTER_ID = m.JOB_MASTER_ID
        WHERE h.SYNC_JOB_ID = p_sync_job_id
            AND h.IS_ACTIVE = 'Y';

        -- Create execution log entry
        RR_SYNC_JOBS_DETAILS_CREATE(
            p_sync_job_id => p_sync_job_id,
            p_parameters => v_parameters,
            p_triggered_by => p_triggered_by,
            p_execution_id => v_execution_id
        );

        -- Retry loop
        <<retry_loop>>
        WHILE v_retry_count <= v_max_retries LOOP
            BEGIN
                -- Step 1: Fetch data from Oracle Fusion
                v_oracle_response := FETCH_FROM_ORACLE(
                    p_base_url => v_oracle_base_url,
                    p_endpoint => v_source_endpoint,
                    p_username => v_oracle_username,
                    p_password => v_oracle_password,
                    p_parameters => v_parameters
                );

                v_fetch_status := 'SUCCESS';

                -- Count fetched records (look for items array)
                BEGIN
                    -- Simple count using JSON_VALUE (in production, use proper JSON parsing)
                    v_fetched_records := 1; -- Placeholder
                EXCEPTION
                    WHEN OTHERS THEN
                        v_fetched_records := 0;
                END;

                -- Step 2: Post data to APEX endpoint
                IF v_destination_endpoint IS NOT NULL THEN
                    v_sync_response := POST_TO_APEX(
                        p_endpoint => v_destination_endpoint,
                        p_data => v_oracle_response
                    );

                    -- Parse sync response to get counts
                    BEGIN
                        v_synced_records := JSON_VALUE(v_sync_response, '$.syncedCount');
                        v_error_records := JSON_VALUE(v_sync_response, '$.errorCount');
                    EXCEPTION
                        WHEN OTHERS THEN
                            v_synced_records := 0;
                            v_error_records := 0;
                    END;

                    v_sync_status := 'SUCCESS';
                ELSE
                    v_sync_status := 'SUCCESS';
                    v_synced_records := v_fetched_records;
                END IF;

                -- Success - exit retry loop
                EXIT retry_loop;

            EXCEPTION
                WHEN OTHERS THEN
                    v_error_message := SUBSTR(SQLERRM, 1, 4000);
                    v_error_details := DBMS_UTILITY.FORMAT_ERROR_STACK || CHR(10) ||
                                       DBMS_UTILITY.FORMAT_ERROR_BACKTRACE;
                    v_fetch_status := 'FAILED';
                    v_sync_status := 'FAILED';

                    v_retry_count := v_retry_count + 1;

                    -- If retry is disabled or max retries reached, exit
                    IF v_retry_on_failure != 'Y' OR v_retry_count > v_max_retries THEN
                        EXIT retry_loop;
                    END IF;

                    -- Wait before retry (exponential backoff)
                    DBMS_LOCK.SLEEP(POWER(2, v_retry_count - 1));
            END;
        END LOOP retry_loop;

        -- Update execution log with results
        RR_SYNC_JOBS_DETAILS_UPDATE(
            p_execution_id => v_execution_id,
            p_fetched_records => v_fetched_records,
            p_synced_records => v_synced_records,
            p_error_records => v_error_records,
            p_fetch_status => v_fetch_status,
            p_sync_status => v_sync_status,
            p_error_message => v_error_message,
            p_error_details => v_error_details,
            p_oracle_response => v_oracle_response,
            p_sync_response => v_sync_response,
            p_retry_count => v_retry_count
        );

        -- Update header statistics
        UPDATE RR_SYNC_JOBS_HEADER
        SET LAST_RUN_DATE = SYSTIMESTAMP,
            TOTAL_EXECUTIONS = TOTAL_EXECUTIONS + 1,
            SUCCESS_COUNT = SUCCESS_COUNT + CASE WHEN v_sync_status = 'SUCCESS' THEN 1 ELSE 0 END,
            FAILURE_COUNT = FAILURE_COUNT + CASE WHEN v_sync_status = 'FAILED' THEN 1 ELSE 0 END
        WHERE SYNC_JOB_ID = p_sync_job_id;

        COMMIT;

        -- Calculate next run date
        CALCULATE_NEXT_RUN(p_sync_job_id);

    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            RAISE_APPLICATION_ERROR(-20001, 'Sync job not found or inactive: ' || p_sync_job_id);
        WHEN OTHERS THEN
            ROLLBACK;
            RAISE;
    END EXECUTE_SYNC_JOB;

    -- =====================================================
    -- EXECUTE_DUE_JOBS - Execute all jobs that are due
    -- =====================================================

    PROCEDURE EXECUTE_DUE_JOBS IS
        CURSOR c_due_jobs IS
            SELECT SYNC_JOB_ID
            FROM RR_SYNC_JOBS_HEADER
            WHERE SCHEDULE_STATUS = 'ACTIVE'
                AND IS_ACTIVE = 'Y'
                AND NEXT_RUN_DATE <= SYSTIMESTAMP
                AND (SCHEDULE_END_DATE IS NULL OR SCHEDULE_END_DATE >= SYSDATE);
    BEGIN
        FOR job IN c_due_jobs LOOP
            BEGIN
                EXECUTE_SYNC_JOB(
                    p_sync_job_id => job.SYNC_JOB_ID,
                    p_triggered_by => 'SCHEDULER'
                );
            EXCEPTION
                WHEN OTHERS THEN
                    -- Log error but continue with other jobs
                    DBMS_OUTPUT.PUT_LINE('Error executing job ' || job.SYNC_JOB_ID || ': ' || SQLERRM);
            END;
        END LOOP;
    END EXECUTE_DUE_JOBS;

    -- =====================================================
    -- GET_JOB_SUMMARY - Get summary for a specific job
    -- =====================================================

    FUNCTION GET_JOB_SUMMARY(
        p_sync_job_id IN NUMBER
    ) RETURN CLOB IS
        v_result CLOB;
    BEGIN
        SELECT JSON_OBJECT(
            'syncJobId' VALUE h.SYNC_JOB_ID,
            'jobName' VALUE h.JOB_NAME,
            'module' VALUE m.MODULE,
            'totalExecutions' VALUE h.TOTAL_EXECUTIONS,
            'successCount' VALUE h.SUCCESS_COUNT,
            'failureCount' VALUE h.FAILURE_COUNT,
            'successRate' VALUE
                CASE WHEN h.TOTAL_EXECUTIONS > 0
                THEN ROUND((h.SUCCESS_COUNT / h.TOTAL_EXECUTIONS) * 100, 2)
                ELSE 0 END,
            'lastRunDate' VALUE TO_CHAR(h.LAST_RUN_DATE, 'YYYY-MM-DD"T"HH24:MI:SS'),
            'nextRunDate' VALUE TO_CHAR(h.NEXT_RUN_DATE, 'YYYY-MM-DD"T"HH24:MI:SS'),
            'scheduleStatus' VALUE h.SCHEDULE_STATUS,
            'isActive' VALUE h.IS_ACTIVE
        )
        INTO v_result
        FROM RR_SYNC_JOBS_HEADER h
        JOIN RR_SYNC_JOBS_MASTER m ON h.JOB_MASTER_ID = m.JOB_MASTER_ID
        WHERE h.SYNC_JOB_ID = p_sync_job_id;

        RETURN v_result;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            RETURN '{"error": "Job not found"}';
    END GET_JOB_SUMMARY;

    -- =====================================================
    -- GET_SYNC_STATISTICS - Get overall statistics
    -- =====================================================

    FUNCTION GET_SYNC_STATISTICS(
        p_module IN VARCHAR2 DEFAULT NULL
    ) RETURN CLOB IS
        v_result CLOB;
    BEGIN
        SELECT JSON_OBJECT(
            'totalJobs' VALUE COUNT(*),
            'activeJobs' VALUE SUM(CASE WHEN h.IS_ACTIVE = 'Y' THEN 1 ELSE 0 END),
            'scheduledJobs' VALUE SUM(CASE WHEN h.SCHEDULE_STATUS = 'ACTIVE' THEN 1 ELSE 0 END),
            'totalExecutions' VALUE SUM(h.TOTAL_EXECUTIONS),
            'totalSuccesses' VALUE SUM(h.SUCCESS_COUNT),
            'totalFailures' VALUE SUM(h.FAILURE_COUNT)
        )
        INTO v_result
        FROM RR_SYNC_JOBS_HEADER h
        JOIN RR_SYNC_JOBS_MASTER m ON h.JOB_MASTER_ID = m.JOB_MASTER_ID
        WHERE p_module IS NULL OR m.MODULE = p_module;

        RETURN v_result;
    END GET_SYNC_STATISTICS;

END RR_SYNC_JOBS_PKG;
/

-- =====================================================
-- Create REST Endpoint for Job Execution
-- =====================================================

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'rr',
        p_pattern        => 'sync/jobs/execute/:id'
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
        p_pattern        => 'sync/jobs/execute/:id',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_source         =>
'BEGIN
    RR_SYNC_JOBS_PKG.EXECUTE_SYNC_JOB(
        p_sync_job_id => :id,
        p_triggered_by => ''USER''
    );

    HTP.print(''{"status": "SUCCESS", "message": "Sync job executed successfully"}'');

EXCEPTION
    WHEN OTHERS THEN
        HTP.print(''{"status": "ERROR", "message": "Error executing sync job: '' || REPLACE(SQLERRM, ''"'', ''\\"'') || ''"}'');
END;'
    );
    COMMIT;
END;
/

-- Create endpoint for job summary
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'rr',
        p_pattern        => 'sync/jobs/summary/:id'
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
        p_pattern        => 'sync/jobs/summary/:id',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_source         =>
'DECLARE
    v_result CLOB;
BEGIN
    v_result := RR_SYNC_JOBS_PKG.GET_JOB_SUMMARY(p_sync_job_id => :id);
    HTP.print(v_result);
END;'
    );
    COMMIT;
END;
/

-- Create endpoint for overall statistics
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'rr',
        p_pattern        => 'sync/jobs/statistics'
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
        p_pattern        => 'sync/jobs/statistics',
        p_method         => 'GET',
        p_source_type    => ORDS.source_type_plsql,
        p_source         =>
'DECLARE
    v_result CLOB;
BEGIN
    v_result := RR_SYNC_JOBS_PKG.GET_SYNC_STATISTICS(p_module => :module);
    HTP.print(v_result);
END;'
    );
    COMMIT;
END;
/

PROMPT
PROMPT =====================================================
PROMPT RR Sync Jobs Package Created Successfully!
PROMPT =====================================================
PROMPT
PROMPT Available Endpoints:
PROMPT POST   /ords/r/wksp_graysapp/rr/sync/jobs/execute/:id
PROMPT GET    /ords/r/wksp_graysapp/rr/sync/jobs/summary/:id
PROMPT GET    /ords/r/wksp_graysapp/rr/sync/jobs/statistics?module=GL
PROMPT
PROMPT Usage:
PROMPT -- Execute a sync job manually:
PROMPT POST /ords/r/wksp_graysapp/rr/sync/jobs/execute/1
PROMPT
PROMPT -- Execute all due jobs (for scheduler):
PROMPT BEGIN RR_SYNC_JOBS_PKG.EXECUTE_DUE_JOBS; END;
PROMPT =====================================================
