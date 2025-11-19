-- ========================================
-- WMS TRIP MANAGEMENT - APEX REST API SETUP (FIXED)
-- ========================================
-- Created: 2025-11-05
-- Updated: 2025-11-05 - Fixed cursor to JSON conversion
-- Purpose: Configure APEX REST APIs for WMS procedures
-- ========================================

-- ========================================
-- NOTES FOR APEX REST API SETUP
-- ========================================
/*
These procedures can be exposed as REST APIs in APEX using:
1. SQL Workshop > RESTful Services > Modules
2. Create Module: WMS_API
3. Create Resource Templates (URIs) and Handlers

IMPORTANT: APEX REST automatically converts SYS_REFCURSOR to JSON!
You don't need manual conversion - just return the cursor.
*/

-- ========================================
-- MODULE DEFINITION
-- ========================================
/*
Module Name:    wms_api
Base Path:      /wms/v1/
Description:    WMS Trip Management API
*/

-- ========================================
-- REST API ENDPOINTS CONFIGURATION
-- ========================================

/*
═══════════════════════════════════════════════════════════════
ENDPOINT 1: GET PRINTER CONFIG
═══════════════════════════════════════════════════════════════
URI Template:   /config/printer
HTTP Method:    GET
Source Type:    PL/SQL
Source:
*/
BEGIN
    wms_get_printer_config(p_cursor => :cursor);
END;
/*
Note: When you set Source Type = "PL/SQL" and declare OUT parameter as :cursor,
APEX REST automatically converts the cursor to JSON array.
*/


/*
═══════════════════════════════════════════════════════════════
ENDPOINT 2: POST SAVE PRINTER CONFIG
═══════════════════════════════════════════════════════════════
URI Template:   /config/printer
HTTP Method:    POST
Source Type:    PL/SQL
Source:
*/
DECLARE
    v_body          CLOB;
    v_result        VARCHAR2(100);
    v_config_id     NUMBER;
    v_printer_name  VARCHAR2(200);
    v_paper_size    VARCHAR2(50);
    v_orientation   VARCHAR2(20);
    v_fusion_inst   VARCHAR2(20);
    v_fusion_user   VARCHAR2(100);
    v_fusion_pass   VARCHAR2(200);
    v_auto_dl       VARCHAR2(1);
    v_auto_print    VARCHAR2(1);
BEGIN
    v_body := :body_text;

    -- Parse JSON using APEX_JSON
    APEX_JSON.parse(v_body);
    v_printer_name := APEX_JSON.get_varchar2('printerName');
    v_paper_size := APEX_JSON.get_varchar2('paperSize');
    v_orientation := APEX_JSON.get_varchar2('orientation');
    v_fusion_inst := APEX_JSON.get_varchar2('fusionInstance');
    v_fusion_user := APEX_JSON.get_varchar2('fusionUsername');
    v_fusion_pass := APEX_JSON.get_varchar2('fusionPassword');
    v_auto_dl := APEX_JSON.get_varchar2('autoDownload');
    v_auto_print := APEX_JSON.get_varchar2('autoPrint');

    -- Call procedure
    wms_save_printer_config(
        p_printer_name => v_printer_name,
        p_paper_size => v_paper_size,
        p_orientation => v_orientation,
        p_fusion_instance => v_fusion_inst,
        p_fusion_username => v_fusion_user,
        p_fusion_password => v_fusion_pass,
        p_auto_download => v_auto_dl,
        p_auto_print => v_auto_print,
        p_result => v_result,
        p_config_id => v_config_id
    );

    -- Return JSON response
    :status_code := CASE WHEN v_result = 'SUCCESS' THEN 200 ELSE 500 END;

    HTP.p('{');
    HTP.p('"success": ' || CASE WHEN v_result = 'SUCCESS' THEN 'true' ELSE 'false' END || ',');
    HTP.p('"message": "' || v_result || '",');
    HTP.p('"configId": ' || NVL(TO_CHAR(v_config_id), 'null'));
    HTP.p('}');
END;


/*
═══════════════════════════════════════════════════════════════
ENDPOINT 3: POST ENABLE AUTO-PRINT
═══════════════════════════════════════════════════════════════
URI Template:   /trips/auto-print/enable
HTTP Method:    POST
Source Type:    PL/SQL
Source:
*/
DECLARE
    v_body              CLOB;
    v_result            VARCHAR2(100);
    v_trip_config_id    NUMBER;
    v_orders_created    NUMBER;
    v_trip_id           VARCHAR2(50);
    v_trip_date         DATE;
    v_orders_json       CLOB;
BEGIN
    v_body := :body_text;

    -- Parse JSON
    APEX_JSON.parse(v_body);
    v_trip_id := APEX_JSON.get_varchar2('tripId');
    v_trip_date := TO_DATE(APEX_JSON.get_varchar2('tripDate'), 'YYYY-MM-DD');

    -- Extract orders array as JSON string
    v_orders_json := APEX_JSON.get_clob('orders');

    -- Call procedure
    wms_enable_auto_print(
        p_trip_id => v_trip_id,
        p_trip_date => v_trip_date,
        p_orders_json => v_orders_json,
        p_result => v_result,
        p_trip_config_id => v_trip_config_id,
        p_orders_created => v_orders_created
    );

    -- Return JSON response
    :status_code := CASE WHEN v_result = 'SUCCESS' THEN 200 ELSE 500 END;

    HTP.p('{');
    HTP.p('"success": ' || CASE WHEN v_result = 'SUCCESS' THEN 'true' ELSE 'false' END || ',');
    HTP.p('"message": "' || v_result || '",');
    HTP.p('"tripConfigId": ' || NVL(TO_CHAR(v_trip_config_id), 'null') || ',');
    HTP.p('"ordersCreated": ' || NVL(TO_CHAR(v_orders_created), '0'));
    HTP.p('}');
END;


/*
═══════════════════════════════════════════════════════════════
ENDPOINT 4: POST DISABLE AUTO-PRINT
═══════════════════════════════════════════════════════════════
URI Template:   /trips/auto-print/disable
HTTP Method:    POST
Source Type:    PL/SQL
Source:
*/
DECLARE
    v_body      CLOB;
    v_result    VARCHAR2(100);
    v_trip_id   VARCHAR2(50);
    v_trip_date DATE;
BEGIN
    v_body := :body_text;

    -- Parse JSON
    APEX_JSON.parse(v_body);
    v_trip_id := APEX_JSON.get_varchar2('tripId');
    v_trip_date := TO_DATE(APEX_JSON.get_varchar2('tripDate'), 'YYYY-MM-DD');

    -- Call procedure
    wms_disable_auto_print(
        p_trip_id => v_trip_id,
        p_trip_date => v_trip_date,
        p_result => v_result
    );

    -- Return JSON response
    :status_code := CASE WHEN v_result = 'SUCCESS' THEN 200 ELSE 500 END;

    HTP.p('{');
    HTP.p('"success": ' || CASE WHEN v_result = 'SUCCESS' THEN 'true' ELSE 'false' END || ',');
    HTP.p('"message": "' || v_result || '"');
    HTP.p('}');
END;


/*
═══════════════════════════════════════════════════════════════
ENDPOINT 5: GET ALL PRINT JOBS
═══════════════════════════════════════════════════════════════
URI Template:   /print-jobs
HTTP Method:    GET
Source Type:    PL/SQL
Source:
*/
DECLARE
    v_start_date    DATE;
    v_end_date      DATE;
    v_status        VARCHAR2(20);
BEGIN
    -- Get query parameters (use :parameter_name for query params)
    BEGIN
        v_start_date := TO_DATE(:startDate, 'YYYY-MM-DD');
    EXCEPTION
        WHEN OTHERS THEN v_start_date := NULL;
    END;

    BEGIN
        v_end_date := TO_DATE(:endDate, 'YYYY-MM-DD');
    EXCEPTION
        WHEN OTHERS THEN v_end_date := NULL;
    END;

    v_status := :status;

    -- Call procedure - APEX auto-converts cursor to JSON
    wms_get_all_print_jobs(
        p_start_date => v_start_date,
        p_end_date => v_end_date,
        p_status_filter => v_status,
        p_cursor => :cursor
    );
END;


/*
═══════════════════════════════════════════════════════════════
ENDPOINT 6: GET PRINT JOB STATISTICS
═══════════════════════════════════════════════════════════════
URI Template:   /print-jobs/stats
HTTP Method:    GET
Source Type:    PL/SQL
Source:
*/
DECLARE
    v_start_date    DATE;
    v_end_date      DATE;
BEGIN
    BEGIN
        v_start_date := TO_DATE(:startDate, 'YYYY-MM-DD');
    EXCEPTION
        WHEN OTHERS THEN v_start_date := NULL;
    END;

    BEGIN
        v_end_date := TO_DATE(:endDate, 'YYYY-MM-DD');
    EXCEPTION
        WHEN OTHERS THEN v_end_date := NULL;
    END;

    wms_get_print_job_stats(
        p_start_date => v_start_date,
        p_end_date => v_end_date,
        p_cursor => :cursor
    );
END;


/*
═══════════════════════════════════════════════════════════════
ENDPOINT 7: GET TRIP CONFIGURATIONS
═══════════════════════════════════════════════════════════════
URI Template:   /trips/configs
HTTP Method:    GET
Source Type:    PL/SQL
Source:
*/
DECLARE
    v_start_date    DATE;
    v_end_date      DATE;
    v_enabled_only  VARCHAR2(1);
BEGIN
    BEGIN
        v_start_date := TO_DATE(:startDate, 'YYYY-MM-DD');
    EXCEPTION
        WHEN OTHERS THEN v_start_date := NULL;
    END;

    BEGIN
        v_end_date := TO_DATE(:endDate, 'YYYY-MM-DD');
    EXCEPTION
        WHEN OTHERS THEN v_end_date := NULL;
    END;

    v_enabled_only := NVL(:enabledOnly, 'N');

    wms_get_trip_configs(
        p_start_date => v_start_date,
        p_end_date => v_end_date,
        p_enabled_only => v_enabled_only,
        p_cursor => :cursor
    );
END;


/*
═══════════════════════════════════════════════════════════════
ENDPOINT 8: GET TRIP SUMMARY
═══════════════════════════════════════════════════════════════
URI Template:   /trips/summary
HTTP Method:    GET
Source Type:    PL/SQL
Source:
*/
DECLARE
    v_start_date    DATE;
    v_end_date      DATE;
BEGIN
    BEGIN
        v_start_date := TO_DATE(:startDate, 'YYYY-MM-DD');
    EXCEPTION
        WHEN OTHERS THEN v_start_date := NULL;
    END;

    BEGIN
        v_end_date := TO_DATE(:endDate, 'YYYY-MM-DD');
    EXCEPTION
        WHEN OTHERS THEN v_end_date := NULL;
    END;

    wms_get_trip_summary(
        p_start_date => v_start_date,
        p_end_date => v_end_date,
        p_cursor => :cursor
    );
END;


/*
═══════════════════════════════════════════════════════════════
ENDPOINT 9: POST UPDATE PRINT JOB STATUS
═══════════════════════════════════════════════════════════════
URI Template:   /print-jobs/update
HTTP Method:    POST
Source Type:    PL/SQL
Source:
*/
DECLARE
    v_body              CLOB;
    v_result            VARCHAR2(100);
    v_job_id            NUMBER;
    v_order_number      VARCHAR2(50);
    v_trip_id           VARCHAR2(50);
    v_trip_date         DATE;
    v_download_status   VARCHAR2(20);
    v_print_status      VARCHAR2(20);
    v_file_path         VARCHAR2(500);
    v_file_size         NUMBER;
    v_error_msg         VARCHAR2(4000);
BEGIN
    v_body := :body_text;

    -- Parse JSON
    APEX_JSON.parse(v_body);
    v_order_number := APEX_JSON.get_varchar2('orderNumber');
    v_trip_id := APEX_JSON.get_varchar2('tripId');
    v_trip_date := TO_DATE(APEX_JSON.get_varchar2('tripDate'), 'YYYY-MM-DD');
    v_download_status := APEX_JSON.get_varchar2('downloadStatus');
    v_print_status := APEX_JSON.get_varchar2('printStatus');
    v_file_path := APEX_JSON.get_varchar2('filePath');
    v_file_size := APEX_JSON.get_number('fileSizeBytes');
    v_error_msg := APEX_JSON.get_varchar2('errorMessage');

    -- Call procedure
    wms_update_print_job(
        p_order_number => v_order_number,
        p_trip_id => v_trip_id,
        p_trip_date => v_trip_date,
        p_download_status => v_download_status,
        p_print_status => v_print_status,
        p_file_path => v_file_path,
        p_file_size_bytes => v_file_size,
        p_error_message => v_error_msg,
        p_result => v_result,
        p_print_job_id => v_job_id
    );

    -- Return JSON response
    :status_code := CASE WHEN v_result = 'SUCCESS' THEN 200 ELSE 500 END;

    HTP.p('{');
    HTP.p('"success": ' || CASE WHEN v_result = 'SUCCESS' THEN 'true' ELSE 'false' END || ',');
    HTP.p('"message": "' || v_result || '",');
    HTP.p('"printJobId": ' || NVL(TO_CHAR(v_job_id), 'null'));
    HTP.p('}');
END;


/*
═══════════════════════════════════════════════════════════════
ENDPOINT 10: GET TRIP PRINT JOBS
═══════════════════════════════════════════════════════════════
URI Template:   /trips/:tripId/:tripDate/jobs
HTTP Method:    GET
Source Type:    PL/SQL
Source:
*/
DECLARE
    v_trip_id   VARCHAR2(50);
    v_trip_date DATE;
BEGIN
    -- Get URI parameters
    v_trip_id := :tripId;
    v_trip_date := TO_DATE(:tripDate, 'YYYY-MM-DD');

    wms_get_trip_print_jobs(
        p_trip_id => v_trip_id,
        p_trip_date => v_trip_date,
        p_cursor => :cursor
    );
END;


/*
═══════════════════════════════════════════════════════════════
ENDPOINT 11: GET FAILED JOBS
═══════════════════════════════════════════════════════════════
URI Template:   /print-jobs/failed
HTTP Method:    GET
Source Type:    PL/SQL
Source:
*/
DECLARE
    v_trip_id   VARCHAR2(50);
    v_trip_date DATE;
BEGIN
    v_trip_id := :tripId;

    BEGIN
        v_trip_date := TO_DATE(:tripDate, 'YYYY-MM-DD');
    EXCEPTION
        WHEN OTHERS THEN v_trip_date := NULL;
    END;

    wms_get_failed_jobs(
        p_trip_id => v_trip_id,
        p_trip_date => v_trip_date,
        p_cursor => :cursor
    );
END;


/*
═══════════════════════════════════════════════════════════════
ENDPOINT 12: POST ASSIGN PICKER TO ORDERS
═══════════════════════════════════════════════════════════════
URI Template:   /picker/assign
HTTP Method:    POST
Source Type:    PL/SQL
Source:
*/
DECLARE
    v_body              CLOB;
    v_result            VARCHAR2(100);
    v_orders_assigned   NUMBER;
    v_orders_json       CLOB;
BEGIN
    v_body := :body_text;

    -- Parse JSON
    APEX_JSON.parse(v_body);

    -- Extract orders array as JSON string
    v_orders_json := APEX_JSON.get_clob('orders');

    -- Call procedure
    wms_assign_picker(
        p_orders_json => v_orders_json,
        p_result => v_result,
        p_orders_assigned => v_orders_assigned
    );

    -- Return JSON response
    :status_code := CASE WHEN v_result = 'SUCCESS' THEN 200 ELSE 500 END;

    HTP.p('{');
    HTP.p('"success": ' || CASE WHEN v_result = 'SUCCESS' THEN 'true' ELSE 'false' END || ',');
    HTP.p('"message": "' || v_result || '",');
    HTP.p('"ordersAssigned": ' || NVL(TO_CHAR(v_orders_assigned), '0'));
    HTP.p('}');
END;


-- ========================================
-- SIMPLIFIED APEX REST MODULE SETUP
-- ========================================
/*
STEP-BY-STEP SETUP IN APEX:

1. Login to APEX
2. Go to SQL Workshop > RESTful Services
3. Click "Create Module"
   - Name: wms_api
   - Base Path: /wms/v1/
   - Protected: No (or Yes with auth)

4. Create each Resource Template and Handler:

EXAMPLE: GET /config/printer
-------------------------
a) Create Resource Template:
   - URI Template: /config/printer

b) Create Handler:
   - Method: GET
   - Source Type: PL/SQL
   - Source: (copy the code from ENDPOINT 1 above)
   - Pagination Size: 25 (for GET endpoints that return lists)

EXAMPLE: POST /config/printer
----------------------------
a) Use same Resource Template: /config/printer

b) Create Handler:
   - Method: POST
   - Source Type: PL/SQL
   - Source: (copy the code from ENDPOINT 2 above)

Repeat for all endpoints listed above.

IMPORTANT NOTES:
- For GET endpoints that return data: Use :cursor parameter
- APEX automatically converts SYS_REFCURSOR to JSON
- For POST endpoints: Use :body_text to access request body
- Use HTP.p() to output response JSON
- Set :status_code for HTTP response codes
*/

-- ========================================
-- TESTING YOUR REST APIS
-- ========================================
/*
After setup, your URLs will be:

Base URL: https://[apex-host]/ords/[workspace]/wms/v1/

Test with cURL:
--------------

# GET: Printer Config
curl https://your-apex.com/ords/workspace/wms/v1/config/printer

# POST: Save Printer Config
curl -X POST https://your-apex.com/ords/workspace/wms/v1/config/printer \
  -H "Content-Type: application/json" \
  -d '{
    "printerName": "HP LaserJet",
    "paperSize": "A4",
    "orientation": "Portrait",
    "fusionInstance": "TEST",
    "fusionUsername": "user",
    "fusionPassword": "pass",
    "autoDownload": "Y",
    "autoPrint": "Y"
  }'

# GET: All Print Jobs
curl https://your-apex.com/ords/workspace/wms/v1/print-jobs

# GET: Print Jobs with filters
curl "https://your-apex.com/ords/workspace/wms/v1/print-jobs?startDate=2025-11-01&status=Completed"

# POST: Enable Auto-Print
curl -X POST https://your-apex.com/ords/workspace/wms/v1/trips/auto-print/enable \
  -H "Content-Type: application/json" \
  -d '{
    "tripId": "TRIP001",
    "tripDate": "2025-11-05",
    "orders": [
      {
        "orderNumber": "ORD001",
        "customerName": "ABC Corp",
        "accountNumber": "ACC001",
        "orderDate": "2025-11-05"
      }
    ]
  }'

# POST: Update Print Job
curl -X POST https://your-apex.com/ords/workspace/wms/v1/print-jobs/update \
  -H "Content-Type: application/json" \
  -d '{
    "orderNumber": "ORD001",
    "tripId": "TRIP001",
    "tripDate": "2025-11-05",
    "downloadStatus": "Completed",
    "filePath": "C:\\\\PDFs\\\\ORD001.pdf"
  }'
*/

-- ========================================
-- TROUBLESHOOTING
-- ========================================
/*
ERROR: "invalid identifier" for APEX_JSON
SOLUTION: Ensure you're using APEX 5.1 or higher

ERROR: Cursor not converting to JSON
SOLUTION: Make sure you use :cursor as OUT parameter name exactly

ERROR: Cannot read :body_text
SOLUTION: Verify HTTP Method is POST and Content-Type is application/json

ERROR: 404 Not Found
SOLUTION: Check Module is published, Base Path is correct, URI Template matches
*/

-- ========================================
-- END OF APEX REST API SETUP
-- ========================================
