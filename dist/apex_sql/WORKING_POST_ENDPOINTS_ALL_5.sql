================================================================================
WORKING POST ENDPOINTS CODE - All 5 Procedures
================================================================================

This file contains working POST endpoint handlers for all 5 POST procedures.
Uses the same HTP.p() pattern that works in your APEX version.

================================================================================


================================================================================
ENDPOINT 1: POST /config/printer
================================================================================
Purpose: Save printer configuration
URI Template: config/printer
Method: POST
Source Type: PL/SQL

Request Body Example:
{
  "printerName": "Microsoft Print to PDF",
  "paperSize": "A4",
  "orientation": "Portrait",
  "fusionInstance": "TEST",
  "fusionUsername": "john.doe",
  "fusionPassword": "password123",
  "autoDownload": "Y",
  "autoPrint": "Y"
}

Handler Code:
--------------------------------------------------------------------------------

DECLARE
    v_printer_name VARCHAR2(200);
    v_paper_size VARCHAR2(50);
    v_orientation VARCHAR2(20);
    v_fusion_instance VARCHAR2(20);
    v_fusion_username VARCHAR2(100);
    v_fusion_password VARCHAR2(200);
    v_auto_download VARCHAR2(1);
    v_auto_print VARCHAR2(1);

    v_result VARCHAR2(200);
    v_config_id NUMBER;
BEGIN
    -- Parse JSON input
    SELECT
        printer_name,
        paper_size,
        orientation,
        fusion_instance,
        fusion_username,
        fusion_password,
        auto_download,
        auto_print
    INTO
        v_printer_name,
        v_paper_size,
        v_orientation,
        v_fusion_instance,
        v_fusion_username,
        v_fusion_password,
        v_auto_download,
        v_auto_print
    FROM JSON_TABLE(
        :body_text, '$'
        COLUMNS (
            printer_name VARCHAR2(200) PATH '$.printerName',
            paper_size VARCHAR2(50) PATH '$.paperSize',
            orientation VARCHAR2(20) PATH '$.orientation',
            fusion_instance VARCHAR2(20) PATH '$.fusionInstance',
            fusion_username VARCHAR2(100) PATH '$.fusionUsername',
            fusion_password VARCHAR2(200) PATH '$.fusionPassword',
            auto_download VARCHAR2(1) PATH '$.autoDownload',
            auto_print VARCHAR2(1) PATH '$.autoPrint'
        )
    );

    -- Call the procedure
    wms_save_printer_config(
        p_printer_name => v_printer_name,
        p_paper_size => v_paper_size,
        p_orientation => v_orientation,
        p_fusion_instance => v_fusion_instance,
        p_fusion_username => v_fusion_username,
        p_fusion_password => v_fusion_password,
        p_auto_download => v_auto_download,
        p_auto_print => v_auto_print,
        p_result => v_result,
        p_config_id => v_config_id
    );

    -- Return JSON response
    IF v_result = 'SUCCESS' THEN
        :status_code := 200;
        HTP.p('{');
        HTP.p('"status":"success",');
        HTP.p('"message":"Printer configuration saved successfully",');
        HTP.p('"configId":' || v_config_id);
        HTP.p('}');
    ELSE
        :status_code := 500;
        HTP.p('{');
        HTP.p('"status":"error",');
        HTP.p('"message":"' || REPLACE(v_result, '"', '\"') || '"');
        HTP.p('}');
    END IF;

EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.p('{');
        HTP.p('"status":"error",');
        HTP.p('"message":"' || REPLACE(SQLERRM, '"', '\"') || '"');
        HTP.p('}');
END;


================================================================================
ENDPOINT 2: POST /trips/enable
================================================================================
Purpose: Enable auto-print for a trip and create print jobs
URI Template: trips/enable
Method: POST
Source Type: PL/SQL

Request Body Example:
{
  "tripId": "TRIP001",
  "tripDate": "2025-11-05",
  "orders": [
    {
      "orderNumber": "ORD001",
      "customerName": "ABC Company",
      "accountNumber": "ACC123",
      "orderDate": "2025-11-05"
    },
    {
      "orderNumber": "ORD002",
      "customerName": "XYZ Corp",
      "accountNumber": "ACC456",
      "orderDate": "2025-11-05"
    }
  ]
}

Handler Code:
--------------------------------------------------------------------------------

DECLARE
    v_trip_id VARCHAR2(50);
    v_trip_date DATE;
    v_orders_json CLOB;

    v_result VARCHAR2(200);
    v_trip_config_id NUMBER;
    v_orders_created NUMBER;
BEGIN
    -- Parse JSON input
    SELECT
        trip_id,
        TO_DATE(trip_date, 'YYYY-MM-DD'),
        orders_json
    INTO
        v_trip_id,
        v_trip_date,
        v_orders_json
    FROM JSON_TABLE(
        :body_text, '$'
        COLUMNS (
            trip_id VARCHAR2(50) PATH '$.tripId',
            trip_date VARCHAR2(20) PATH '$.tripDate',
            orders_json CLOB PATH '$.orders'
        )
    );

    -- Call the procedure
    wms_enable_auto_print(
        p_trip_id => v_trip_id,
        p_trip_date => v_trip_date,
        p_orders_json => v_orders_json,
        p_result => v_result,
        p_trip_config_id => v_trip_config_id,
        p_orders_created => v_orders_created
    );

    -- Return JSON response
    IF v_result = 'SUCCESS' THEN
        :status_code := 200;
        HTP.p('{');
        HTP.p('"status":"success",');
        HTP.p('"message":"Auto-print enabled successfully",');
        HTP.p('"tripConfigId":' || v_trip_config_id || ',');
        HTP.p('"ordersCreated":' || v_orders_created);
        HTP.p('}');
    ELSE
        :status_code := 500;
        HTP.p('{');
        HTP.p('"status":"error",');
        HTP.p('"message":"' || REPLACE(v_result, '"', '\"') || '"');
        HTP.p('}');
    END IF;

EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.p('{');
        HTP.p('"status":"error",');
        HTP.p('"message":"' || REPLACE(SQLERRM, '"', '\"') || '"');
        HTP.p('}');
END;


================================================================================
ENDPOINT 3: POST /trips/disable
================================================================================
Purpose: Disable auto-print for a trip
URI Template: trips/disable
Method: POST
Source Type: PL/SQL

Request Body Example:
{
  "tripId": "TRIP001",
  "tripDate": "2025-11-05"
}

Handler Code:
--------------------------------------------------------------------------------

DECLARE
    v_trip_id VARCHAR2(50);
    v_trip_date DATE;

    v_result VARCHAR2(200);
BEGIN
    -- Parse JSON input
    SELECT
        trip_id,
        TO_DATE(trip_date, 'YYYY-MM-DD')
    INTO
        v_trip_id,
        v_trip_date
    FROM JSON_TABLE(
        :body_text, '$'
        COLUMNS (
            trip_id VARCHAR2(50) PATH '$.tripId',
            trip_date VARCHAR2(20) PATH '$.tripDate'
        )
    );

    -- Call the procedure
    wms_disable_auto_print(
        p_trip_id => v_trip_id,
        p_trip_date => v_trip_date,
        p_result => v_result
    );

    -- Return JSON response
    IF v_result = 'SUCCESS' THEN
        :status_code := 200;
        HTP.p('{');
        HTP.p('"status":"success",');
        HTP.p('"message":"Auto-print disabled successfully"');
        HTP.p('}');
    ELSE
        :status_code := 500;
        HTP.p('{');
        HTP.p('"status":"error",');
        HTP.p('"message":"' || REPLACE(v_result, '"', '\"') || '"');
        HTP.p('}');
    END IF;

EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.p('{');
        HTP.p('"status":"error",');
        HTP.p('"message":"' || REPLACE(SQLERRM, '"', '\"') || '"');
        HTP.p('}');
END;


================================================================================
ENDPOINT 4: POST /print-jobs/update
================================================================================
Purpose: Update individual print job status
URI Template: print-jobs/update
Method: POST
Source Type: PL/SQL

Request Body Example:
{
  "orderNumber": "ORD001",
  "tripId": "TRIP001",
  "tripDate": "2025-11-05",
  "downloadStatus": "Completed",
  "printStatus": "Printing",
  "filePath": "C:\\PDFs\\ORD001.pdf",
  "fileSizeBytes": 524288,
  "errorMessage": null
}

Handler Code:
--------------------------------------------------------------------------------

DECLARE
    v_order_number VARCHAR2(50);
    v_trip_id VARCHAR2(50);
    v_trip_date DATE;
    v_download_status VARCHAR2(20);
    v_print_status VARCHAR2(20);
    v_file_path VARCHAR2(500);
    v_file_size_bytes NUMBER;
    v_error_message VARCHAR2(4000);

    v_result VARCHAR2(200);
    v_print_job_id NUMBER;
BEGIN
    -- Parse JSON input
    SELECT
        order_number,
        trip_id,
        TO_DATE(trip_date, 'YYYY-MM-DD'),
        download_status,
        print_status,
        file_path,
        file_size_bytes,
        error_message
    INTO
        v_order_number,
        v_trip_id,
        v_trip_date,
        v_download_status,
        v_print_status,
        v_file_path,
        v_file_size_bytes,
        v_error_message
    FROM JSON_TABLE(
        :body_text, '$'
        COLUMNS (
            order_number VARCHAR2(50) PATH '$.orderNumber',
            trip_id VARCHAR2(50) PATH '$.tripId',
            trip_date VARCHAR2(20) PATH '$.tripDate',
            download_status VARCHAR2(20) PATH '$.downloadStatus',
            print_status VARCHAR2(20) PATH '$.printStatus',
            file_path VARCHAR2(500) PATH '$.filePath',
            file_size_bytes NUMBER PATH '$.fileSizeBytes',
            error_message VARCHAR2(4000) PATH '$.errorMessage'
        )
    );

    -- Call the procedure
    wms_update_print_job(
        p_order_number => v_order_number,
        p_trip_id => v_trip_id,
        p_trip_date => v_trip_date,
        p_download_status => v_download_status,
        p_print_status => v_print_status,
        p_file_path => v_file_path,
        p_file_size_bytes => v_file_size_bytes,
        p_error_message => v_error_message,
        p_result => v_result,
        p_print_job_id => v_print_job_id
    );

    -- Return JSON response
    IF v_result = 'SUCCESS' THEN
        :status_code := 200;
        HTP.p('{');
        HTP.p('"status":"success",');
        HTP.p('"message":"Print job updated successfully",');
        HTP.p('"printJobId":' || v_print_job_id);
        HTP.p('}');
    ELSE
        :status_code := 500;
        HTP.p('{');
        HTP.p('"status":"error",');
        HTP.p('"message":"' || REPLACE(v_result, '"', '\"') || '"');
        HTP.p('}');
    END IF;

EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.p('{');
        HTP.p('"status":"error",');
        HTP.p('"message":"' || REPLACE(SQLERRM, '"', '\"') || '"');
        HTP.p('}');
END;


================================================================================
ENDPOINT 5: POST /print-jobs/bulk-update
================================================================================
Purpose: Bulk update multiple print jobs
URI Template: print-jobs/bulk-update
Method: POST
Source Type: PL/SQL

Request Body Example:
{
  "jobs": [
    {
      "orderNumber": "ORD001",
      "tripId": "TRIP001",
      "tripDate": "2025-11-05",
      "downloadStatus": "Completed",
      "printStatus": "Printed",
      "filePath": "C:\\PDFs\\ORD001.pdf"
    },
    {
      "orderNumber": "ORD002",
      "tripId": "TRIP001",
      "tripDate": "2025-11-05",
      "downloadStatus": "Failed",
      "errorMessage": "Connection timeout"
    }
  ]
}

Handler Code:
--------------------------------------------------------------------------------

DECLARE
    v_jobs_json CLOB;

    v_result VARCHAR2(200);
    v_updated_count NUMBER;
BEGIN
    -- Extract jobs array as CLOB
    SELECT jobs_json
    INTO v_jobs_json
    FROM JSON_TABLE(
        :body_text, '$'
        COLUMNS (
            jobs_json CLOB PATH '$.jobs'
        )
    );

    -- Call the procedure
    wms_bulk_update_jobs(
        p_jobs_json => v_jobs_json,
        p_result => v_result,
        p_updated_count => v_updated_count
    );

    -- Return JSON response
    IF v_result = 'SUCCESS' THEN
        :status_code := 200;
        HTP.p('{');
        HTP.p('"status":"success",');
        HTP.p('"message":"Jobs updated successfully",');
        HTP.p('"updatedCount":' || v_updated_count);
        HTP.p('}');
    ELSE
        :status_code := 500;
        HTP.p('{');
        HTP.p('"status":"error",');
        HTP.p('"message":"' || REPLACE(v_result, '"', '\"') || '"');
        HTP.p('}');
    END IF;

EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.p('{');
        HTP.p('"status":"error",');
        HTP.p('"message":"' || REPLACE(SQLERRM, '"', '\"') || '"');
        HTP.p('}');
END;


================================================================================
SETUP INSTRUCTIONS FOR EACH POST ENDPOINT
================================================================================

For each POST endpoint above, follow these steps in APEX:

1. Go to SQL Workshop → RESTful Services
2. Click your module: wms_api
3. Click "Create Template" (or use existing one)
4. Enter the URI Template (shown above for each endpoint)
5. Click "Create Template"
6. Click on the template you just created
7. Click "Create Handler"
8. Fill in:
   - Method: POST
   - Source Type: PL/SQL
   - Requires Secure Access: No
9. Copy and paste the Handler Code from above
10. Click "Create Handler"
11. NO need to add any parameters (JSON comes from :body_text automatically)
12. Click "Test" button - you'll need to provide JSON in the body
13. Test in Postman


================================================================================
POSTMAN TESTING GUIDE
================================================================================

For each POST endpoint:

1. Create new request in Postman
2. Set method to POST
3. Enter URL: https://your-apex-url/ords/workspace/wms/v1/{endpoint}
4. Go to Headers tab:
   - Add: Content-Type: application/json
5. Go to Body tab:
   - Select "raw"
   - Select "JSON" from dropdown
   - Paste the example JSON from above
6. Click Send
7. Verify you get HTTP 200 and {"status":"success",...}


Example URLs:
- POST https://your-apex-url/ords/workspace/wms/v1/config/printer
- POST https://your-apex-url/ords/workspace/wms/v1/trips/enable
- POST https://your-apex-url/ords/workspace/wms/v1/trips/disable
- POST https://your-apex-url/ords/workspace/wms/v1/print-jobs/update
- POST https://your-apex-url/ords/workspace/wms/v1/print-jobs/bulk-update


================================================================================
IMPORTANT NOTES
================================================================================

1. ✅ :body_text - Automatically contains the JSON request body
2. ✅ :status_code - Set this to control HTTP response code (200, 400, 500, etc.)
3. ✅ JSON_TABLE - Used to parse JSON input (Oracle 12c+)
4. ✅ HTP.p() - Used to build JSON response output
5. ✅ All procedures handle COMMIT/ROLLBACK internally
6. ✅ Error messages are captured and returned in JSON format
7. ✅ All dates use YYYY-MM-DD format
8. ✅ camelCase in JSON is converted to snake_case for procedure parameters


================================================================================
ERROR HANDLING
================================================================================

All endpoints return standard JSON format:

Success Response (HTTP 200):
{
  "status": "success",
  "message": "Operation completed successfully",
  "configId": 123  // or other relevant data
}

Error Response (HTTP 500):
{
  "status": "error",
  "message": "ERROR: Description of what went wrong"
}


================================================================================
TESTING CHECKLIST
================================================================================

Test each endpoint:

☐ 1. POST /config/printer
   - Save new printer config
   - Verify old config is deactivated
   - Test with GET /config/printer

☐ 2. POST /trips/enable
   - Enable trip with orders array
   - Verify trip config created
   - Verify print jobs created
   - Test with GET /trips/summary

☐ 3. POST /trips/disable
   - Disable existing trip
   - Verify trip config updated
   - Test with GET /trips/configs

☐ 4. POST /print-jobs/update
   - Update single job status
   - Test different statuses (Downloading, Completed, Failed, Printing, Printed)
   - Verify history log created
   - Test with GET /print-jobs

☐ 5. POST /print-jobs/bulk-update
   - Update multiple jobs at once
   - Verify all jobs updated
   - Test with GET /print-jobs/stats


================================================================================
COMMON ERRORS AND FIXES
================================================================================

Error: ORA-40478: output value too large
Fix: Make sure CLOB columns are used for large JSON arrays

Error: ORA-40441: JSON syntax error
Fix: Verify your JSON is valid (use jsonlint.com)

Error: No data found
Fix: Check JSON field names match exactly (camelCase vs snake_case)

Error: HTTP 555
Fix: Check that all variables match the JSON_TABLE output columns


================================================================================
SUMMARY
================================================================================

✅ POST /config/printer - Save printer configuration
✅ POST /trips/enable - Enable auto-print for trip with orders
✅ POST /trips/disable - Disable auto-print for trip
✅ POST /print-jobs/update - Update individual print job status
✅ POST /print-jobs/bulk-update - Bulk update multiple print jobs

All using the WORKING HTP.p() pattern! 🚀

Copy each code block into its respective APEX POST handler and test!
