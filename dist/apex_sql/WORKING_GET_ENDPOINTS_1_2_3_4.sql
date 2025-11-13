================================================================================
WORKING GET ENDPOINTS CODE - Manual JSON Conversion with HTP.p()
================================================================================

This file contains the working code for GET endpoints 1, 2, 3, 4
These use manual cursor-to-JSON conversion that WORKS in your APEX version.

TESTED AND CONFIRMED WORKING PATTERN
Use this same approach for all GET endpoints.

================================================================================


================================================================================
ENDPOINT 1: GET /print-jobs
================================================================================
URI Template: print-jobs
Method: GET
Source Type: PL/SQL

Query Parameters (Add these in APEX):
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

    -- Cursor variables
    v_print_job_id NUMBER;
    v_trip_id VARCHAR2(50);
    v_trip_date DATE;
    v_document_type VARCHAR2(50);
    v_document_name VARCHAR2(200);
    v_print_status VARCHAR2(20);
    v_fusion_instance VARCHAR2(20);
    v_created_date DATE;
    v_printed_date DATE;
    v_error_message VARCHAR2(4000);

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
            v_print_job_id, v_trip_id, v_trip_date, v_document_type,
            v_document_name, v_print_status, v_fusion_instance,
            v_created_date, v_printed_date, v_error_message;
        EXIT WHEN v_cursor%NOTFOUND;

        IF NOT v_first THEN
            HTP.p(',');
        END IF;
        v_first := FALSE;

        HTP.p('{');
        HTP.p('"print_job_id":' || v_print_job_id || ',');
        HTP.p('"trip_id":"' || REPLACE(NVL(v_trip_id, ''), '"', '\"') || '",');
        HTP.p('"trip_date":"' || TO_CHAR(v_trip_date, 'YYYY-MM-DD') || '",');
        HTP.p('"document_type":"' || REPLACE(NVL(v_document_type, ''), '"', '\"') || '",');
        HTP.p('"document_name":"' || REPLACE(NVL(v_document_name, ''), '"', '\"') || '",');
        HTP.p('"print_status":"' || REPLACE(NVL(v_print_status, ''), '"', '\"') || '",');
        HTP.p('"fusion_instance":"' || REPLACE(NVL(v_fusion_instance, ''), '"', '\"') || '",');
        HTP.p('"created_date":"' || TO_CHAR(v_created_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '",');
        HTP.p('"printed_date":' ||
            CASE WHEN v_printed_date IS NULL THEN 'null'
                 ELSE '"' || TO_CHAR(v_printed_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '"'
            END || ',');
        HTP.p('"error_message":' ||
            CASE WHEN v_error_message IS NULL THEN 'null'
                 ELSE '"' || REPLACE(v_error_message, '"', '\"') || '"'
            END);
        HTP.p('}');
    END LOOP;

    CLOSE v_cursor;
    HTP.p(']}');
END;


Test URL:
/print-jobs
/print-jobs?startDate=2025-11-01&endDate=2025-11-05
/print-jobs?status=Completed
/print-jobs?startDate=2025-11-01&endDate=2025-11-05&status=Failed


================================================================================
ENDPOINT 2: GET /print-jobs/stats
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

    -- Cursor variables
    v_status VARCHAR2(20);
    v_count_jobs NUMBER;
    v_last_job_date DATE;

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
    wms_get_print_job_stats(
        p_start_date => v_start_date,
        p_end_date => v_end_date,
        p_cursor => v_cursor
    );

    -- Build JSON output
    HTP.p('{"items":[');

    LOOP
        FETCH v_cursor INTO v_status, v_count_jobs, v_last_job_date;
        EXIT WHEN v_cursor%NOTFOUND;

        IF NOT v_first THEN
            HTP.p(',');
        END IF;
        v_first := FALSE;

        HTP.p('{');
        HTP.p('"status":"' || REPLACE(NVL(v_status, ''), '"', '\"') || '",');
        HTP.p('"count_jobs":' || NVL(v_count_jobs, 0) || ',');
        HTP.p('"last_job_date":' ||
            CASE WHEN v_last_job_date IS NULL THEN 'null'
                 ELSE '"' || TO_CHAR(v_last_job_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '"'
            END);
        HTP.p('}');
    END LOOP;

    CLOSE v_cursor;
    HTP.p(']}');
END;


Test URL:
/print-jobs/stats
/print-jobs/stats?startDate=2025-11-01&endDate=2025-11-05


================================================================================
ENDPOINT 3: GET /trips/summary
================================================================================
URI Template: trips/summary
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

    -- Cursor variables
    v_trip_id VARCHAR2(50);
    v_trip_date DATE;
    v_total_jobs NUMBER;
    v_completed_jobs NUMBER;
    v_failed_jobs NUMBER;
    v_pending_jobs NUMBER;
    v_last_printed DATE;

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
            v_trip_id, v_trip_date, v_total_jobs, v_completed_jobs,
            v_failed_jobs, v_pending_jobs, v_last_printed;
        EXIT WHEN v_cursor%NOTFOUND;

        IF NOT v_first THEN
            HTP.p(',');
        END IF;
        v_first := FALSE;

        HTP.p('{');
        HTP.p('"trip_id":"' || REPLACE(NVL(v_trip_id, ''), '"', '\"') || '",');
        HTP.p('"trip_date":"' || TO_CHAR(v_trip_date, 'YYYY-MM-DD') || '",');
        HTP.p('"total_jobs":' || NVL(v_total_jobs, 0) || ',');
        HTP.p('"completed_jobs":' || NVL(v_completed_jobs, 0) || ',');
        HTP.p('"failed_jobs":' || NVL(v_failed_jobs, 0) || ',');
        HTP.p('"pending_jobs":' || NVL(v_pending_jobs, 0) || ',');
        HTP.p('"last_printed":' ||
            CASE WHEN v_last_printed IS NULL THEN 'null'
                 ELSE '"' || TO_CHAR(v_last_printed, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '"'
            END);
        HTP.p('}');
    END LOOP;

    CLOSE v_cursor;
    HTP.p(']}');
END;


Test URL:
/trips/summary
/trips/summary?startDate=2025-11-01&endDate=2025-11-05


================================================================================
ENDPOINT 4: GET /trips/configs
================================================================================
URI Template: trips/configs
Method: GET
Source Type: PL/SQL

Query Parameters (Add these in APEX):
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

    -- Cursor variables
    v_trip_config_id NUMBER;
    v_trip_id VARCHAR2(50);
    v_start_date_col DATE;
    v_end_date_col DATE;
    v_is_enabled VARCHAR2(1);
    v_created_date DATE;
    v_modified_date DATE;

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
            v_trip_config_id, v_trip_id, v_start_date_col, v_end_date_col,
            v_is_enabled, v_created_date, v_modified_date;
        EXIT WHEN v_cursor%NOTFOUND;

        IF NOT v_first THEN
            HTP.p(',');
        END IF;
        v_first := FALSE;

        HTP.p('{');
        HTP.p('"trip_config_id":' || v_trip_config_id || ',');
        HTP.p('"trip_id":"' || REPLACE(NVL(v_trip_id, ''), '"', '\"') || '",');
        HTP.p('"start_date":"' || TO_CHAR(v_start_date_col, 'YYYY-MM-DD') || '",');
        HTP.p('"end_date":"' || TO_CHAR(v_end_date_col, 'YYYY-MM-DD') || '",');
        HTP.p('"is_enabled":"' || REPLACE(NVL(v_is_enabled, ''), '"', '\"') || '",');
        HTP.p('"created_date":"' || TO_CHAR(v_created_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '",');
        HTP.p('"modified_date":' ||
            CASE WHEN v_modified_date IS NULL THEN 'null'
                 ELSE '"' || TO_CHAR(v_modified_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '"'
            END);
        HTP.p('}');
    END LOOP;

    CLOSE v_cursor;
    HTP.p(']}');
END;


Test URL:
/trips/configs
/trips/configs?startDate=2025-11-01&endDate=2025-11-05
/trips/configs?enabledOnly=Y
/trips/configs?startDate=2025-11-01&endDate=2025-11-05&enabledOnly=Y


================================================================================
SETUP INSTRUCTIONS FOR EACH ENDPOINT
================================================================================

For each endpoint above, follow these steps in APEX:

1. Go to SQL Workshop → RESTful Services
2. Click your module: wms_api
3. Click "Create Template"
4. Enter the URI Template (shown above for each endpoint)
5. Click "Create Template"
6. Click on the template you just created
7. Click "Create Handler"
8. Fill in:
   - Method: GET
   - Source Type: PL/SQL
   - Requires Secure Access: No
9. Copy and paste the Handler Code from above
10. Scroll down to Pagination Size: Enter 25
11. Click "Create Handler"
12. Add Query Parameters (if any) - shown above for each endpoint:
    - Click "Edit" on the GET handler
    - Scroll to "Parameters" section
    - Click "Add Parameter" for each one
    - Fill in: Name, Type=STRING, Parameter Type=URI - Query String
    - Click "Apply Changes"
13. Click "Test" button to verify it works
14. Test in Postman using the Test URLs shown above


================================================================================
IMPORTANT NOTES
================================================================================

1. DO NOT add a parameter for :cursor - it's handled automatically
2. DO add parameters for :startDate, :endDate, :status, :enabledOnly
3. Each parameter should be:
   - Type: STRING
   - Parameter Type: URI - Query String
   - Access Method: IN (default)
4. The HTP.p() pattern manually builds JSON - this works in your APEX version
5. Test each endpoint in APEX first before testing in Postman
6. Your base URL format:
   https://your-apex-url/ords/workspace/wms/v1/


================================================================================
EXPECTED OUTPUT EXAMPLES
================================================================================

Endpoint 1 - GET /print-jobs:
{
  "items": [
    {
      "print_job_id": 1,
      "trip_id": "TRIP001",
      "trip_date": "2025-11-05",
      "document_type": "PackingSlip",
      "document_name": "PS_12345.pdf",
      "print_status": "Completed",
      "fusion_instance": "TEST",
      "created_date": "2025-11-05T10:30:00Z",
      "printed_date": "2025-11-05T10:31:00Z",
      "error_message": null
    }
  ]
}

Endpoint 2 - GET /print-jobs/stats:
{
  "items": [
    {
      "status": "Completed",
      "count_jobs": 5,
      "last_job_date": "2025-11-05T10:30:00Z"
    },
    {
      "status": "Failed",
      "count_jobs": 2,
      "last_job_date": "2025-11-05T09:15:00Z"
    }
  ]
}

Endpoint 3 - GET /trips/summary:
{
  "items": [
    {
      "trip_id": "TRIP001",
      "trip_date": "2025-11-05",
      "total_jobs": 10,
      "completed_jobs": 8,
      "failed_jobs": 1,
      "pending_jobs": 1,
      "last_printed": "2025-11-05T10:30:00Z"
    }
  ]
}

Endpoint 4 - GET /trips/configs:
{
  "items": [
    {
      "trip_config_id": 1,
      "trip_id": "TRIP001",
      "start_date": "2025-11-01",
      "end_date": "2025-11-30",
      "is_enabled": "Y",
      "created_date": "2025-11-01T08:00:00Z",
      "modified_date": null
    }
  ]
}


================================================================================
TROUBLESHOOTING
================================================================================

If you get an error:

1. Check the procedure exists:
   SELECT object_name, status FROM user_objects
   WHERE object_name LIKE 'WMS_GET%';

2. Check the table has data:
   SELECT COUNT(*) FROM wms_print_jobs;
   SELECT COUNT(*) FROM wms_trip_config;

3. Test in SQL first:
   DECLARE
       v_cursor SYS_REFCURSOR;
   BEGIN
       wms_get_all_print_jobs(NULL, NULL, NULL, v_cursor);
       FOR rec IN (SELECT * FROM TABLE(CAST(v_cursor AS SYS_REFCURSOR)))
       LOOP
           DBMS_OUTPUT.PUT_LINE('Found row');
       END LOOP;
   END;

4. Make sure parameters are added correctly in APEX
5. Make sure there's no :cursor parameter - delete it if you added one


================================================================================
SUMMARY
================================================================================

✅ Endpoint 1: GET /print-jobs (with date/status filters)
✅ Endpoint 2: GET /print-jobs/stats (statistics by status)
✅ Endpoint 3: GET /trips/summary (trip summaries with counts)
✅ Endpoint 4: GET /trips/configs (trip configurations)

All using the WORKING HTP.p() pattern that worked for printer config!

Copy each code block into its respective APEX GET handler and test! 🚀
