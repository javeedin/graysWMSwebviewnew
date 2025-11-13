-- ========================================
-- APEX REST API - GET ENDPOINTS CODE
-- ========================================
-- Copy and paste these into APEX REST handlers
-- ========================================

/*
HOW TO USE:
1. Login to APEX
2. Go to SQL Workshop > RESTful Services
3. Create Module: wms_api, Base Path: /wms/v1/
4. For each endpoint below:
   - Create Resource Template (URI)
   - Create Handler (Method = GET)
   - Paste the code into Source
*/


-- ========================================
-- GET ENDPOINT 1: PRINTER CONFIG
-- ========================================
-- Resource Template: /config/printer
-- Method: GET
-- Source Type: PL/SQL
-- Pagination Size: 25

BEGIN
    wms_get_printer_config(p_cursor => :cursor);
END;


-- ========================================
-- GET ENDPOINT 2: ALL PRINT JOBS
-- ========================================
-- Resource Template: /print-jobs
-- Method: GET
-- Source Type: PL/SQL
-- Pagination Size: 25
-- Parameters: startDate (Query), endDate (Query), status (Query)

DECLARE
    v_start_date DATE;
    v_end_date DATE;
    v_status VARCHAR2(20);
BEGIN
    -- Parse query parameters
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

    v_status := :status;

    -- Call procedure
    wms_get_all_print_jobs(
        p_start_date => v_start_date,
        p_end_date => v_end_date,
        p_status_filter => v_status,
        p_cursor => :cursor
    );
END;


-- ========================================
-- GET ENDPOINT 3: PRINT JOB STATISTICS
-- ========================================
-- Resource Template: /print-jobs/stats
-- Method: GET
-- Source Type: PL/SQL
-- Pagination Size: 25
-- Parameters: startDate (Query), endDate (Query)

DECLARE
    v_start_date DATE;
    v_end_date DATE;
BEGIN
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

    wms_get_print_job_stats(
        p_start_date => v_start_date,
        p_end_date => v_end_date,
        p_cursor => :cursor
    );
END;


-- ========================================
-- GET ENDPOINT 4: TRIP CONFIGURATIONS
-- ========================================
-- Resource Template: /trips/configs
-- Method: GET
-- Source Type: PL/SQL
-- Pagination Size: 25
-- Parameters: startDate (Query), endDate (Query), enabledOnly (Query)

DECLARE
    v_start_date DATE;
    v_end_date DATE;
    v_enabled_only VARCHAR2(1);
BEGIN
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

    wms_get_trip_configs(
        p_start_date => v_start_date,
        p_end_date => v_end_date,
        p_enabled_only => v_enabled_only,
        p_cursor => :cursor
    );
END;


-- ========================================
-- GET ENDPOINT 5: TRIP SUMMARY (DASHBOARD)
-- ========================================
-- Resource Template: /trips/summary
-- Method: GET
-- Source Type: PL/SQL
-- Pagination Size: 25
-- Parameters: startDate (Query), endDate (Query)

DECLARE
    v_start_date DATE;
    v_end_date DATE;
BEGIN
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

    wms_get_trip_summary(
        p_start_date => v_start_date,
        p_end_date => v_end_date,
        p_cursor => :cursor
    );
END;


-- ========================================
-- GET ENDPOINT 6: PRINT JOBS BY TRIP
-- ========================================
-- Resource Template: /trips/:tripId/:tripDate/jobs
-- Method: GET
-- Source Type: PL/SQL
-- Pagination Size: 25
-- Parameters: tripId (URI Template), tripDate (URI Template)

DECLARE
    v_trip_id VARCHAR2(50);
    v_trip_date DATE;
BEGIN
    v_trip_id := :tripId;

    BEGIN
        v_trip_date := TO_DATE(:tripDate, 'YYYY-MM-DD');
    EXCEPTION
        WHEN OTHERS THEN
            -- Try alternate format
            v_trip_date := TO_DATE(:tripDate, 'YYYYMMDD');
    END;

    wms_get_trip_print_jobs(
        p_trip_id => v_trip_id,
        p_trip_date => v_trip_date,
        p_cursor => :cursor
    );
END;


-- ========================================
-- GET ENDPOINT 7: FAILED JOBS FOR RETRY
-- ========================================
-- Resource Template: /print-jobs/failed
-- Method: GET
-- Source Type: PL/SQL
-- Pagination Size: 25
-- Parameters: tripId (Query), tripDate (Query)

DECLARE
    v_trip_id VARCHAR2(50);
    v_trip_date DATE;
BEGIN
    v_trip_id := :tripId;

    BEGIN
        v_trip_date := TO_DATE(:tripDate, 'YYYY-MM-DD');
    EXCEPTION
        WHEN OTHERS THEN
            v_trip_date := NULL;
    END;

    wms_get_failed_jobs(
        p_trip_id => v_trip_id,
        p_trip_date => v_trip_date,
        p_cursor => :cursor
    );
END;


-- ========================================
-- GET ENDPOINT 8: PRINT JOB HISTORY
-- ========================================
-- Resource Template: /print-jobs/:jobId/history
-- Method: GET
-- Source Type: PL/SQL
-- Pagination Size: 25
-- Parameters: jobId (URI Template)

DECLARE
    v_job_id NUMBER;
BEGIN
    v_job_id := TO_NUMBER(:jobId);

    wms_get_print_job_history(
        p_print_job_id => v_job_id,
        p_cursor => :cursor
    );
END;


-- ========================================
-- SUMMARY OF ALL GET ENDPOINTS
-- ========================================

/*
┌─────┬─────────────────────────────────────┬──────────────────────────────────┐
│  #  │ URI Template                        │ Query/URI Parameters             │
├─────┼─────────────────────────────────────┼──────────────────────────────────┤
│  1  │ /config/printer                     │ None                             │
│  2  │ /print-jobs                         │ startDate, endDate, status       │
│  3  │ /print-jobs/stats                   │ startDate, endDate               │
│  4  │ /trips/configs                      │ startDate, endDate, enabledOnly  │
│  5  │ /trips/summary                      │ startDate, endDate               │
│  6  │ /trips/:tripId/:tripDate/jobs       │ tripId (URI), tripDate (URI)     │
│  7  │ /print-jobs/failed                  │ tripId, tripDate                 │
│  8  │ /print-jobs/:jobId/history          │ jobId (URI)                      │
└─────┴─────────────────────────────────────┴──────────────────────────────────┘
*/


-- ========================================
-- EXAMPLE URLS AFTER SETUP
-- ========================================

/*
Assuming your APEX URL is:
https://your-apex.com/ords/workspace/wms/v1/

1. Get printer config:
   GET https://your-apex.com/ords/workspace/wms/v1/config/printer

2. Get all print jobs:
   GET https://your-apex.com/ords/workspace/wms/v1/print-jobs

3. Get print jobs with filters:
   GET https://your-apex.com/ords/workspace/wms/v1/print-jobs?startDate=2025-11-01&endDate=2025-11-05&status=Completed

4. Get statistics:
   GET https://your-apex.com/ords/workspace/wms/v1/print-jobs/stats?startDate=2025-11-01

5. Get trip configurations:
   GET https://your-apex.com/ords/workspace/wms/v1/trips/configs?enabledOnly=Y

6. Get trip summary:
   GET https://your-apex.com/ords/workspace/wms/v1/trips/summary

7. Get jobs for specific trip:
   GET https://your-apex.com/ords/workspace/wms/v1/trips/TRIP001/2025-11-05/jobs

8. Get failed jobs:
   GET https://your-apex.com/ords/workspace/wms/v1/print-jobs/failed

9. Get job history:
   GET https://your-apex.com/ords/workspace/wms/v1/print-jobs/123/history
*/


-- ========================================
-- EXPECTED JSON RESPONSE FORMAT
-- ========================================

/*
All GET endpoints return this standard APEX format:

{
  "items": [
    {
      "column1": "value1",
      "column2": "value2",
      ...
    }
  ],
  "hasMore": false,
  "limit": 25,
  "offset": 0,
  "count": 1,
  "links": [
    {
      "rel": "self",
      "href": "..."
    }
  ]
}

Example for /print-jobs:
{
  "items": [
    {
      "print_job_id": 1,
      "order_number": "ORD001",
      "trip_id": "TRIP001",
      "trip_date": "2025-11-05",
      "customer_name": "ABC Company",
      "status": "Completed",
      "file_path": "C:\\PDFs\\ORD001.pdf",
      "created_date": "2025-11-05T10:30:00"
    }
  ],
  "hasMore": false,
  "limit": 25,
  "offset": 0,
  "count": 1
}
*/


-- ========================================
-- CURL TEST COMMANDS
-- ========================================

/*
# Test 1: Get printer config
curl -X GET "https://your-apex.com/ords/workspace/wms/v1/config/printer"

# Test 2: Get all print jobs
curl -X GET "https://your-apex.com/ords/workspace/wms/v1/print-jobs"

# Test 3: Get print jobs with date filter
curl -X GET "https://your-apex.com/ords/workspace/wms/v1/print-jobs?startDate=2025-11-01&endDate=2025-11-05"

# Test 4: Get print jobs with status filter
curl -X GET "https://your-apex.com/ords/workspace/wms/v1/print-jobs?status=Completed"

# Test 5: Get statistics
curl -X GET "https://your-apex.com/ords/workspace/wms/v1/print-jobs/stats"

# Test 6: Get trip configs (enabled only)
curl -X GET "https://your-apex.com/ords/workspace/wms/v1/trips/configs?enabledOnly=Y"

# Test 7: Get trip summary
curl -X GET "https://your-apex.com/ords/workspace/wms/v1/trips/summary"

# Test 8: Get jobs for specific trip
curl -X GET "https://your-apex.com/ords/workspace/wms/v1/trips/TRIP001/2025-11-05/jobs"

# Test 9: Get failed jobs
curl -X GET "https://your-apex.com/ords/workspace/wms/v1/print-jobs/failed"

# Test 10: Get job history
curl -X GET "https://your-apex.com/ords/workspace/wms/v1/print-jobs/123/history"
*/


-- ========================================
-- NOTES
-- ========================================

/*
1. :cursor is a special bind variable in APEX REST
   - APEX automatically converts SYS_REFCURSOR to JSON
   - No manual JSON conversion needed

2. Query parameters use :paramName syntax
   - Example: :startDate, :endDate, :status

3. URI template parameters also use :paramName
   - Example: :tripId, :tripDate, :jobId

4. Date format is YYYY-MM-DD
   - Example: 2025-11-05

5. All GET endpoints support pagination
   - Set Pagination Size in APEX (recommended: 25)
   - APEX adds hasMore, limit, offset automatically

6. Error handling is automatic
   - APEX wraps exceptions in JSON format
   - Returns appropriate HTTP status codes
*/
