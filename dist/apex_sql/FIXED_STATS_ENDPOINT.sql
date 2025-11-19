================================================================================
FIXED GET /print-jobs/stats ENDPOINT
================================================================================

This is the CORRECTED code for the stats endpoint.
The previous version had wrong variables that didn't match the procedure output.

================================================================================
ENDPOINT: GET /print-jobs/stats
================================================================================
URI Template: print-jobs/stats
Method: GET
Source Type: PL/SQL

Query Parameters (Add these in APEX):
- startDate (STRING, Query String)
- endDate (STRING, Query String)

Handler Code:
--------------------------------------------------------------------------------

DECLARE
    v_cursor SYS_REFCURSOR;
    v_start_date DATE;
    v_end_date DATE;

    -- Cursor variables - MUST MATCH procedure output columns
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
TEST URL
================================================================================

/print-jobs/stats
/print-jobs/stats?startDate=2025-11-01&endDate=2025-11-05


================================================================================
EXPECTED OUTPUT
================================================================================

{
  "items": [
    {
      "total_jobs": 25,
      "pending_download": 3,
      "downloading": 2,
      "download_completed": 5,
      "pending_print": 4,
      "printed": 10,
      "failed": 1,
      "retried_jobs": 2,
      "avg_retry_count": 0.5,
      "avg_download_time_seconds": 12.45
    }
  ]
}


================================================================================
SETUP IN APEX
================================================================================

1. Go to SQL Workshop → RESTful Services
2. Click your module: wms_api
3. Click on "print-jobs/stats" template (or create it if you haven't)
4. Click "Edit" on the GET handler
5. Replace the entire Source code with the code above
6. Add Query Parameters:
   - Name: startDate, Type: STRING, Parameter Type: URI - Query String
   - Name: endDate, Type: STRING, Parameter Type: URI - Query String
7. Click "Apply Changes"
8. Click "Test" to verify


================================================================================
THE ISSUE
================================================================================

The original code had:
    v_status VARCHAR2(20);
    v_count_jobs NUMBER;
    v_last_job_date DATE;

But the wms_get_print_job_stats procedure actually returns:
    total_jobs
    pending_download
    downloading
    download_completed
    pending_print
    printed
    failed
    retried_jobs
    avg_retry_count
    avg_download_time_seconds

The variables MUST exactly match what the procedure returns!


================================================================================
NOTES
================================================================================

1. This procedure returns ONE ROW with statistics summary
2. All the counts represent different status categories
3. avg_retry_count is the average number of retries across all jobs
4. avg_download_time_seconds is the average download time in seconds
5. The LOOP will only iterate once since it returns a single summary row
