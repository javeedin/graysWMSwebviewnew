================================================================================
FULLY CORRECTED - ALL 4 GET ENDPOINTS
================================================================================

ALL endpoints now have the CORRECT variables that match the procedure outputs!

IMPORTANT: Replace your existing endpoint code with these corrected versions.

================================================================================


================================================================================
ENDPOINT 1: GET /print-jobs
================================================================================
URI Template: print-jobs
Method: GET
Source Type: PL/SQL

Query Parameters:
- startDate (STRING, Query String)
- endDate (STRING, Query String)
- status (STRING, Query String)

Handler Code:
--------------------------------------------------------------------------------

DECLARE
    v_cursor SYS_REFCURSOR;
    v_start_date DATE;
    v_end_date DATE;
    v_status_filter VARCHAR2(20);

    -- Cursor variables - MUST MATCH wms_get_all_print_jobs output (22 columns)
    v_print_job_id NUMBER;
    v_order_number VARCHAR2(50);
    v_trip_id VARCHAR2(50);
    v_trip_date DATE;
    v_customer_name VARCHAR2(200);
    v_account_number VARCHAR2(50);
    v_order_date DATE;
    v_download_status VARCHAR2(20);
    v_print_status VARCHAR2(20);
    v_status VARCHAR2(20);
    v_file_path VARCHAR2(500);
    v_file_size_bytes NUMBER;
    v_error_message VARCHAR2(4000);
    v_retry_count NUMBER;
    v_download_started DATE;
    v_download_completed DATE;
    v_print_started DATE;
    v_print_completed DATE;
    v_created_date DATE;
    v_modified_date DATE;
    v_auto_print_enabled VARCHAR2(1);
    v_trip_total_orders NUMBER;

    v_first BOOLEAN := TRUE;
BEGIN
    -- Parse date parameters
    BEGIN
        v_start_date := TO_DATE(:startDate, 'YYYY-MM-DD');
    EXCEPTION
        WHEN OTHERS THEN
            v_start_date := NULL;
    END;

    BEGIN
        v_end_date := TO_DATE(:endDate, 'YYYY-MM-DD');
    EXCEPTION
        WHEN OTHERS THEN
            v_end_date := NULL;
    END;

    v_status_filter := :status;

    -- Call the procedure
    wms_get_all_print_jobs(
        p_start_date => v_start_date,
        p_end_date => v_end_date,
        p_status_filter => v_status_filter,
        p_cursor => v_cursor
    );

    -- Build JSON output
    HTP.p('{"items":[');

    LOOP
        FETCH v_cursor INTO
            v_print_job_id, v_order_number, v_trip_id, v_trip_date,
            v_customer_name, v_account_number, v_order_date,
            v_download_status, v_print_status, v_status,
            v_file_path, v_file_size_bytes, v_error_message, v_retry_count,
            v_download_started, v_download_completed,
            v_print_started, v_print_completed,
            v_created_date, v_modified_date,
            v_auto_print_enabled, v_trip_total_orders;
        EXIT WHEN v_cursor%NOTFOUND;

        IF NOT v_first THEN
            HTP.p(',');
        END IF;
        v_first := FALSE;

        HTP.p('{');
        HTP.p('"print_job_id":' || v_print_job_id || ',');
        HTP.p('"order_number":"' || REPLACE(NVL(v_order_number, ''), '"', '\"') || '",');
        HTP.p('"trip_id":"' || REPLACE(NVL(v_trip_id, ''), '"', '\"') || '",');
        HTP.p('"trip_date":"' || TO_CHAR(v_trip_date, 'YYYY-MM-DD') || '",');
        HTP.p('"customer_name":"' || REPLACE(NVL(v_customer_name, ''), '"', '\"') || '",');
        HTP.p('"account_number":"' || REPLACE(NVL(v_account_number, ''), '"', '\"') || '",');
        HTP.p('"order_date":' ||
            CASE WHEN v_order_date IS NULL THEN 'null'
                 ELSE '"' || TO_CHAR(v_order_date, 'YYYY-MM-DD') || '"'
            END || ',');
        HTP.p('"download_status":"' || REPLACE(NVL(v_download_status, ''), '"', '\"') || '",');
        HTP.p('"print_status":"' || REPLACE(NVL(v_print_status, ''), '"', '\"') || '",');
        HTP.p('"status":"' || REPLACE(NVL(v_status, ''), '"', '\"') || '",');
        HTP.p('"file_path":"' || REPLACE(NVL(v_file_path, ''), '"', '\"') || '",');
        HTP.p('"file_size_bytes":' || NVL(v_file_size_bytes, 0) || ',');
        HTP.p('"error_message":' ||
            CASE WHEN v_error_message IS NULL THEN 'null'
                 ELSE '"' || REPLACE(v_error_message, '"', '\"') || '"'
            END || ',');
        HTP.p('"retry_count":' || NVL(v_retry_count, 0) || ',');
        HTP.p('"download_started":' ||
            CASE WHEN v_download_started IS NULL THEN 'null'
                 ELSE '"' || TO_CHAR(v_download_started, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '"'
            END || ',');
        HTP.p('"download_completed":' ||
            CASE WHEN v_download_completed IS NULL THEN 'null'
                 ELSE '"' || TO_CHAR(v_download_completed, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '"'
            END || ',');
        HTP.p('"print_started":' ||
            CASE WHEN v_print_started IS NULL THEN 'null'
                 ELSE '"' || TO_CHAR(v_print_started, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '"'
            END || ',');
        HTP.p('"print_completed":' ||
            CASE WHEN v_print_completed IS NULL THEN 'null'
                 ELSE '"' || TO_CHAR(v_print_completed, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '"'
            END || ',');
        HTP.p('"created_date":"' || TO_CHAR(v_created_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '",');
        HTP.p('"modified_date":' ||
            CASE WHEN v_modified_date IS NULL THEN 'null'
                 ELSE '"' || TO_CHAR(v_modified_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '"'
            END || ',');
        HTP.p('"auto_print_enabled":"' || NVL(v_auto_print_enabled, 'N') || '",');
        HTP.p('"trip_total_orders":' || NVL(v_trip_total_orders, 0));
        HTP.p('}');
    END LOOP;

    CLOSE v_cursor;
    HTP.p(']}');
END;


================================================================================
ENDPOINT 2: GET /print-jobs/stats
================================================================================
URI Template: print-jobs/stats
Method: GET
Source Type: PL/SQL

Query Parameters:
- startDate (STRING, Query String)
- endDate (STRING, Query String)

Handler Code:
--------------------------------------------------------------------------------

DECLARE
    v_cursor SYS_REFCURSOR;
    v_start_date DATE;
    v_end_date DATE;

    -- Cursor variables - MUST MATCH wms_get_print_job_stats output (10 columns)
    v_total_jobs NUMBER;
    v_pending_download NUMBER;
    v_downloading NUMBER;
    v_download_completed NUMBER;
    v_pending_print NUMBER;
    v_printed NUMBER;
    v_failed NUMBER;
    v_retried_jobs NUMBER;
    v_avg_retry_count NUMBER;
    v_avg_download_time_seconds NUMBER;

BEGIN
    -- Parse date parameters
    BEGIN
        v_start_date := TO_DATE(:startDate, 'YYYY-MM-DD');
    EXCEPTION
        WHEN OTHERS THEN
            v_start_date := NULL;
    END;

    BEGIN
        v_end_date := TO_DATE(:endDate, 'YYYY-MM-DD');
    EXCEPTION
        WHEN OTHERS THEN
            v_end_date := NULL;
    END;

    -- Call the procedure
    wms_get_print_job_stats(
        p_start_date => v_start_date,
        p_end_date => v_end_date,
        p_cursor => v_cursor
    );

    -- Build JSON output
    HTP.p('{"items":[');

    LOOP
        FETCH v_cursor INTO
            v_total_jobs,
            v_pending_download,
            v_downloading,
            v_download_completed,
            v_pending_print,
            v_printed,
            v_failed,
            v_retried_jobs,
            v_avg_retry_count,
            v_avg_download_time_seconds;
        EXIT WHEN v_cursor%NOTFOUND;

        HTP.p('{');
        HTP.p('"total_jobs":' || NVL(v_total_jobs, 0) || ',');
        HTP.p('"pending_download":' || NVL(v_pending_download, 0) || ',');
        HTP.p('"downloading":' || NVL(v_downloading, 0) || ',');
        HTP.p('"download_completed":' || NVL(v_download_completed, 0) || ',');
        HTP.p('"pending_print":' || NVL(v_pending_print, 0) || ',');
        HTP.p('"printed":' || NVL(v_printed, 0) || ',');
        HTP.p('"failed":' || NVL(v_failed, 0) || ',');
        HTP.p('"retried_jobs":' || NVL(v_retried_jobs, 0) || ',');
        HTP.p('"avg_retry_count":' || NVL(v_avg_retry_count, 0) || ',');
        HTP.p('"avg_download_time_seconds":' || NVL(v_avg_download_time_seconds, 0));
        HTP.p('}');
    END LOOP;

    CLOSE v_cursor;
    HTP.p(']}');
END;


================================================================================
ENDPOINT 3: GET /trips/summary
================================================================================
URI Template: trips/summary
Method: GET
Source Type: PL/SQL

Query Parameters:
- startDate (STRING, Query String)
- endDate (STRING, Query String)

Handler Code:
--------------------------------------------------------------------------------

DECLARE
    v_cursor SYS_REFCURSOR;
    v_start_date DATE;
    v_end_date DATE;

    -- Cursor variables - MUST MATCH wms_get_trip_summary output (13 columns)
    v_trip_id VARCHAR2(50);
    v_trip_date DATE;
    v_total_orders NUMBER;
    v_downloaded_orders NUMBER;
    v_printed_orders NUMBER;
    v_failed_orders NUMBER;
    v_auto_print_enabled VARCHAR2(1);
    v_completion_pct NUMBER;
    v_failure_pct NUMBER;
    v_status VARCHAR2(50);
    v_first_download_start DATE;
    v_last_print_complete DATE;
    v_avg_processing_minutes NUMBER;

    v_first BOOLEAN := TRUE;
BEGIN
    -- Parse date parameters
    BEGIN
        v_start_date := TO_DATE(:startDate, 'YYYY-MM-DD');
    EXCEPTION
        WHEN OTHERS THEN
            v_start_date := NULL;
    END;

    BEGIN
        v_end_date := TO_DATE(:endDate, 'YYYY-MM-DD');
    EXCEPTION
        WHEN OTHERS THEN
            v_end_date := NULL;
    END;

    -- Call the procedure
    wms_get_trip_summary(
        p_start_date => v_start_date,
        p_end_date => v_end_date,
        p_cursor => v_cursor
    );

    -- Build JSON output
    HTP.p('{"items":[');

    LOOP
        FETCH v_cursor INTO
            v_trip_id, v_trip_date, v_total_orders, v_downloaded_orders,
            v_printed_orders, v_failed_orders, v_auto_print_enabled,
            v_completion_pct, v_failure_pct, v_status,
            v_first_download_start, v_last_print_complete, v_avg_processing_minutes;
        EXIT WHEN v_cursor%NOTFOUND;

        IF NOT v_first THEN
            HTP.p(',');
        END IF;
        v_first := FALSE;

        HTP.p('{');
        HTP.p('"trip_id":"' || REPLACE(NVL(v_trip_id, ''), '"', '\"') || '",');
        HTP.p('"trip_date":"' || TO_CHAR(v_trip_date, 'YYYY-MM-DD') || '",');
        HTP.p('"total_orders":' || NVL(v_total_orders, 0) || ',');
        HTP.p('"downloaded_orders":' || NVL(v_downloaded_orders, 0) || ',');
        HTP.p('"printed_orders":' || NVL(v_printed_orders, 0) || ',');
        HTP.p('"failed_orders":' || NVL(v_failed_orders, 0) || ',');
        HTP.p('"auto_print_enabled":"' || NVL(v_auto_print_enabled, 'N') || '",');
        HTP.p('"completion_pct":' || NVL(v_completion_pct, 0) || ',');
        HTP.p('"failure_pct":' || NVL(v_failure_pct, 0) || ',');
        HTP.p('"status":"' || REPLACE(NVL(v_status, ''), '"', '\"') || '",');
        HTP.p('"first_download_start":' ||
            CASE WHEN v_first_download_start IS NULL THEN 'null'
                 ELSE '"' || TO_CHAR(v_first_download_start, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '"'
            END || ',');
        HTP.p('"last_print_complete":' ||
            CASE WHEN v_last_print_complete IS NULL THEN 'null'
                 ELSE '"' || TO_CHAR(v_last_print_complete, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '"'
            END || ',');
        HTP.p('"avg_processing_minutes":' || NVL(v_avg_processing_minutes, 0));
        HTP.p('}');
    END LOOP;

    CLOSE v_cursor;
    HTP.p(']}');
END;


================================================================================
ENDPOINT 4: GET /trips/configs
================================================================================
URI Template: trips/configs
Method: GET
Source Type: PL/SQL

Query Parameters:
- startDate (STRING, Query String)
- endDate (STRING, Query String)
- enabledOnly (STRING, Query String)

Handler Code:
--------------------------------------------------------------------------------

DECLARE
    v_cursor SYS_REFCURSOR;
    v_start_date DATE;
    v_end_date DATE;
    v_enabled_only VARCHAR2(1);

    -- Cursor variables - MUST MATCH wms_get_trip_configs output (16 columns)
    v_trip_config_id NUMBER;
    v_trip_id VARCHAR2(50);
    v_trip_date DATE;
    v_auto_print_enabled VARCHAR2(1);
    v_total_orders NUMBER;
    v_downloaded_orders NUMBER;
    v_printed_orders NUMBER;
    v_failed_orders NUMBER;
    v_enabled_by VARCHAR2(100);
    v_enabled_date DATE;
    v_disabled_by VARCHAR2(100);
    v_disabled_date DATE;
    v_created_date DATE;
    v_modified_date DATE;
    v_progress_percentage NUMBER;
    v_trip_status VARCHAR2(50);

    v_first BOOLEAN := TRUE;
BEGIN
    -- Parse date parameters
    BEGIN
        v_start_date := TO_DATE(:startDate, 'YYYY-MM-DD');
    EXCEPTION
        WHEN OTHERS THEN
            v_start_date := NULL;
    END;

    BEGIN
        v_end_date := TO_DATE(:endDate, 'YYYY-MM-DD');
    EXCEPTION
        WHEN OTHERS THEN
            v_end_date := NULL;
    END;

    v_enabled_only := NVL(:enabledOnly, 'N');

    -- Call the procedure
    wms_get_trip_configs(
        p_start_date => v_start_date,
        p_end_date => v_end_date,
        p_enabled_only => v_enabled_only,
        p_cursor => v_cursor
    );

    -- Build JSON output
    HTP.p('{"items":[');

    LOOP
        FETCH v_cursor INTO
            v_trip_config_id, v_trip_id, v_trip_date, v_auto_print_enabled,
            v_total_orders, v_downloaded_orders, v_printed_orders, v_failed_orders,
            v_enabled_by, v_enabled_date, v_disabled_by, v_disabled_date,
            v_created_date, v_modified_date, v_progress_percentage, v_trip_status;
        EXIT WHEN v_cursor%NOTFOUND;

        IF NOT v_first THEN
            HTP.p(',');
        END IF;
        v_first := FALSE;

        HTP.p('{');
        HTP.p('"trip_config_id":' || v_trip_config_id || ',');
        HTP.p('"trip_id":"' || REPLACE(NVL(v_trip_id, ''), '"', '\"') || '",');
        HTP.p('"trip_date":"' || TO_CHAR(v_trip_date, 'YYYY-MM-DD') || '",');
        HTP.p('"auto_print_enabled":"' || NVL(v_auto_print_enabled, 'N') || '",');
        HTP.p('"total_orders":' || NVL(v_total_orders, 0) || ',');
        HTP.p('"downloaded_orders":' || NVL(v_downloaded_orders, 0) || ',');
        HTP.p('"printed_orders":' || NVL(v_printed_orders, 0) || ',');
        HTP.p('"failed_orders":' || NVL(v_failed_orders, 0) || ',');
        HTP.p('"enabled_by":' ||
            CASE WHEN v_enabled_by IS NULL THEN 'null'
                 ELSE '"' || REPLACE(v_enabled_by, '"', '\"') || '"'
            END || ',');
        HTP.p('"enabled_date":' ||
            CASE WHEN v_enabled_date IS NULL THEN 'null'
                 ELSE '"' || TO_CHAR(v_enabled_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '"'
            END || ',');
        HTP.p('"disabled_by":' ||
            CASE WHEN v_disabled_by IS NULL THEN 'null'
                 ELSE '"' || REPLACE(v_disabled_by, '"', '\"') || '"'
            END || ',');
        HTP.p('"disabled_date":' ||
            CASE WHEN v_disabled_date IS NULL THEN 'null'
                 ELSE '"' || TO_CHAR(v_disabled_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '"'
            END || ',');
        HTP.p('"created_date":"' || TO_CHAR(v_created_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '",');
        HTP.p('"modified_date":' ||
            CASE WHEN v_modified_date IS NULL THEN 'null'
                 ELSE '"' || TO_CHAR(v_modified_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '"'
            END || ',');
        HTP.p('"progress_percentage":' || NVL(v_progress_percentage, 0) || ',');
        HTP.p('"trip_status":"' || REPLACE(NVL(v_trip_status, ''), '"', '\"') || '"');
        HTP.p('}');
    END LOOP;

    CLOSE v_cursor;
    HTP.p(']}');
END;


================================================================================
SETUP CHECKLIST
================================================================================

For each endpoint:

1. ✅ Go to APEX → SQL Workshop → RESTful Services → wms_api
2. ✅ Find or create the URI Template
3. ✅ Edit the GET handler
4. ✅ Replace ALL the code with the corrected version above
5. ✅ Add the Query Parameters (if not already added)
6. ✅ Click "Apply Changes"
7. ✅ Click "Test" to verify
8. ✅ Test in Postman


================================================================================
THE ROOT CAUSE OF ERRORS
================================================================================

The ORA-06504 error happens when the number or types of variables in the FETCH
statement don't match what the procedure's cursor returns.

Original issues:
- Endpoint 1: Had 10 variables, needed 22
- Endpoint 2: Had 3 variables, needed 10
- Endpoint 3: Had 7 variables, needed 13
- Endpoint 4: Had 7 variables, needed 16

NOW ALL FIXED! ✅


================================================================================
TESTING
================================================================================

Test URLs:
1. GET /print-jobs?startDate=2025-11-01&endDate=2025-11-05
2. GET /print-jobs/stats?startDate=2025-11-01
3. GET /trips/summary?startDate=2025-11-01
4. GET /trips/configs?enabledOnly=Y


================================================================================
NOTES
================================================================================

1. All column names now match the procedures exactly
2. All data types match (VARCHAR2, NUMBER, DATE)
3. All 22 columns for print jobs are included
4. All 10 stats columns are included
5. All 13 trip summary columns are included
6. All 16 trip config columns are included
7. Date formatting uses ISO 8601 format with timezone
8. NULL values are properly handled
9. String escaping handles double quotes correctly
10. All cursors are properly closed after fetching
