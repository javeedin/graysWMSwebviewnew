-- ========================================
-- WMS TRIP MANAGEMENT - TESTING GUIDE
-- ========================================
-- How to test procedures and REST APIs
-- ========================================

-- ========================================
-- METHOD 1: TEST IN SQL*PLUS / SQL DEVELOPER
-- ========================================

-- Test 1: GET PRINTER CONFIG
-- ---------------------------
SET SERVEROUTPUT ON
DECLARE
    v_cursor SYS_REFCURSOR;
    v_config_id NUMBER;
    v_printer_name VARCHAR2(200);
    v_fusion_instance VARCHAR2(20);
BEGIN
    -- Call the procedure
    wms_get_printer_config(p_cursor => v_cursor);

    -- Fetch and display results
    DBMS_OUTPUT.PUT_LINE('=== Printer Configuration ===');
    LOOP
        FETCH v_cursor INTO v_config_id, v_printer_name, v_fusion_instance;
        EXIT WHEN v_cursor%NOTFOUND;

        DBMS_OUTPUT.PUT_LINE('Config ID: ' || v_config_id);
        DBMS_OUTPUT.PUT_LINE('Printer: ' || v_printer_name);
        DBMS_OUTPUT.PUT_LINE('Instance: ' || v_fusion_instance);
    END LOOP;

    CLOSE v_cursor;
    DBMS_OUTPUT.PUT_LINE('Test completed successfully!');
EXCEPTION
    WHEN OTHERS THEN
        DBMS_OUTPUT.PUT_LINE('ERROR: ' || SQLERRM);
        IF v_cursor%ISOPEN THEN
            CLOSE v_cursor;
        END IF;
END;
/


-- Test 2: GET ALL PRINT JOBS
-- ---------------------------
SET SERVEROUTPUT ON
DECLARE
    v_cursor SYS_REFCURSOR;
    TYPE t_job_rec IS RECORD (
        print_job_id NUMBER,
        order_number VARCHAR2(50),
        trip_id VARCHAR2(50),
        status VARCHAR2(20)
    );
    v_job t_job_rec;
    v_count NUMBER := 0;
BEGIN
    -- Call the procedure
    wms_get_all_print_jobs(
        p_start_date => SYSDATE - 30,
        p_end_date => SYSDATE,
        p_status_filter => NULL,
        p_cursor => v_cursor
    );

    -- Fetch and display results
    DBMS_OUTPUT.PUT_LINE('=== Print Jobs (Last 30 Days) ===');
    LOOP
        FETCH v_cursor INTO
            v_job.print_job_id,
            v_job.order_number,
            v_job.trip_id,
            v_job.status;
        EXIT WHEN v_cursor%NOTFOUND;

        v_count := v_count + 1;
        DBMS_OUTPUT.PUT_LINE('Job #' || v_count || ': Order=' || v_job.order_number ||
                           ', Trip=' || v_job.trip_id || ', Status=' || v_job.status);
    END LOOP;

    CLOSE v_cursor;
    DBMS_OUTPUT.PUT_LINE('Total jobs found: ' || v_count);
EXCEPTION
    WHEN OTHERS THEN
        DBMS_OUTPUT.PUT_LINE('ERROR: ' || SQLERRM);
END;
/


-- Test 3: SAVE PRINTER CONFIG
-- ----------------------------
SET SERVEROUTPUT ON
DECLARE
    v_result VARCHAR2(100);
    v_config_id NUMBER;
BEGIN
    wms_save_printer_config(
        p_printer_name => 'Test Printer',
        p_paper_size => 'A4',
        p_orientation => 'Portrait',
        p_fusion_instance => 'TEST',
        p_fusion_username => 'testuser',
        p_fusion_password => 'testpass',
        p_auto_download => 'Y',
        p_auto_print => 'Y',
        p_result => v_result,
        p_config_id => v_config_id
    );

    DBMS_OUTPUT.PUT_LINE('Result: ' || v_result);
    DBMS_OUTPUT.PUT_LINE('Config ID: ' || v_config_id);

    IF v_result = 'SUCCESS' THEN
        DBMS_OUTPUT.PUT_LINE('✅ Test PASSED');
    ELSE
        DBMS_OUTPUT.PUT_LINE('❌ Test FAILED');
    END IF;
END;
/


-- Test 4: ENABLE AUTO-PRINT
-- --------------------------
SET SERVEROUTPUT ON
DECLARE
    v_result VARCHAR2(100);
    v_trip_config_id NUMBER;
    v_orders_created NUMBER;
    v_orders_json CLOB;
BEGIN
    -- Create test orders JSON
    v_orders_json := '[
        {
            "orderNumber": "TEST001",
            "customerName": "Test Customer 1",
            "accountNumber": "ACC001",
            "orderDate": "2025-11-05"
        },
        {
            "orderNumber": "TEST002",
            "customerName": "Test Customer 2",
            "accountNumber": "ACC002",
            "orderDate": "2025-11-05"
        }
    ]';

    -- Call procedure
    wms_enable_auto_print(
        p_trip_id => 'TEST_TRIP',
        p_trip_date => TRUNC(SYSDATE),
        p_orders_json => v_orders_json,
        p_result => v_result,
        p_trip_config_id => v_trip_config_id,
        p_orders_created => v_orders_created
    );

    DBMS_OUTPUT.PUT_LINE('Result: ' || v_result);
    DBMS_OUTPUT.PUT_LINE('Trip Config ID: ' || v_trip_config_id);
    DBMS_OUTPUT.PUT_LINE('Orders Created: ' || v_orders_created);

    IF v_result = 'SUCCESS' THEN
        DBMS_OUTPUT.PUT_LINE('✅ Test PASSED');
    ELSE
        DBMS_OUTPUT.PUT_LINE('❌ Test FAILED');
    END IF;
END;
/


-- Test 5: UPDATE PRINT JOB
-- -------------------------
SET SERVEROUTPUT ON
DECLARE
    v_result VARCHAR2(100);
    v_print_job_id NUMBER;
BEGIN
    wms_update_print_job(
        p_order_number => 'TEST001',
        p_trip_id => 'TEST_TRIP',
        p_trip_date => TRUNC(SYSDATE),
        p_download_status => 'Completed',
        p_print_status => NULL,
        p_file_path => 'C:\PDFs\TEST001.pdf',
        p_file_size_bytes => 102400,
        p_error_message => NULL,
        p_result => v_result,
        p_print_job_id => v_print_job_id
    );

    DBMS_OUTPUT.PUT_LINE('Result: ' || v_result);
    DBMS_OUTPUT.PUT_LINE('Print Job ID: ' || v_print_job_id);

    IF v_result = 'SUCCESS' THEN
        DBMS_OUTPUT.PUT_LINE('✅ Test PASSED');
    ELSE
        DBMS_OUTPUT.PUT_LINE('❌ Test FAILED');
    END IF;
END;
/


-- Test 6: GET PRINT JOB STATISTICS
-- ---------------------------------
SET SERVEROUTPUT ON
DECLARE
    v_cursor SYS_REFCURSOR;
    v_total NUMBER;
    v_pending NUMBER;
    v_completed NUMBER;
    v_failed NUMBER;
BEGIN
    wms_get_print_job_stats(
        p_start_date => SYSDATE - 30,
        p_end_date => SYSDATE,
        p_cursor => v_cursor
    );

    -- Fetch stats
    FETCH v_cursor INTO v_total, v_pending, v_completed, v_failed;

    DBMS_OUTPUT.PUT_LINE('=== Print Job Statistics ===');
    DBMS_OUTPUT.PUT_LINE('Total Jobs: ' || v_total);
    DBMS_OUTPUT.PUT_LINE('Pending: ' || v_pending);
    DBMS_OUTPUT.PUT_LINE('Completed: ' || v_completed);
    DBMS_OUTPUT.PUT_LINE('Failed: ' || v_failed);

    CLOSE v_cursor;
END;
/


-- Test 7: DISABLE AUTO-PRINT
-- ---------------------------
SET SERVEROUTPUT ON
DECLARE
    v_result VARCHAR2(100);
BEGIN
    wms_disable_auto_print(
        p_trip_id => 'TEST_TRIP',
        p_trip_date => TRUNC(SYSDATE),
        p_result => v_result
    );

    DBMS_OUTPUT.PUT_LINE('Result: ' || v_result);

    IF v_result = 'SUCCESS' THEN
        DBMS_OUTPUT.PUT_LINE('✅ Test PASSED');
    ELSE
        DBMS_OUTPUT.PUT_LINE('❌ Test FAILED');
    END IF;
END;
/


-- Clean up test data (optional)
-- ------------------------------
-- Uncomment to remove test data after testing
/*
DELETE FROM wms_print_jobs
WHERE trip_id = 'TEST_TRIP';

DELETE FROM wms_trip_config
WHERE trip_id = 'TEST_TRIP';

COMMIT;
DBMS_OUTPUT.PUT_LINE('Test data cleaned up');
*/


-- ========================================
-- METHOD 2: TEST DIRECTLY IN APEX SQL COMMANDS
-- ========================================

/*
1. Go to SQL Workshop > SQL Commands
2. Run these commands one by one:
*/

-- Quick test - Get all print jobs
BEGIN
    FOR rec IN (
        SELECT print_job_id, order_number, trip_id, overall_status
        FROM wms_print_jobs
        WHERE ROWNUM <= 5
        ORDER BY created_date DESC
    ) LOOP
        DBMS_OUTPUT.PUT_LINE(rec.order_number || ' - ' || rec.overall_status);
    END LOOP;
END;


-- ========================================
-- METHOD 3: TEST REST APIS IN APEX
-- ========================================

/*
After you've set up the REST module in APEX:

1. Go to SQL Workshop > RESTful Services
2. Click on your module "wms_api"
3. Click on a Resource Template (e.g., /print-jobs)
4. Click on the Handler (GET)
5. Click "Test" button at the top
6. APEX will show you the JSON response

OR use the built-in REST testing:
1. Click on the module name
2. Click "Export OpenAPI" to get the API spec
3. Use Postman or curl to test
*/


-- ========================================
-- METHOD 4: TEST WITH cURL (COMMAND LINE)
-- ========================================

/*
After REST API is set up in APEX, test from command line:

# Replace YOUR_APEX_URL with your actual APEX URL
# Example: https://apex.oracle.com/pls/apex/yourworkspace/wms/v1

# Test GET - Printer Config
curl -X GET "YOUR_APEX_URL/config/printer"

# Test GET - All Print Jobs
curl -X GET "YOUR_APEX_URL/print-jobs"

# Test GET - Print Jobs with filters
curl -X GET "YOUR_APEX_URL/print-jobs?startDate=2025-11-01&status=Completed"

# Test POST - Save Printer Config
curl -X POST "YOUR_APEX_URL/config/printer" \
  -H "Content-Type: application/json" \
  -d '{
    "printerName": "HP LaserJet",
    "paperSize": "A4",
    "orientation": "Portrait",
    "fusionInstance": "TEST",
    "fusionUsername": "testuser",
    "fusionPassword": "testpass",
    "autoDownload": "Y",
    "autoPrint": "Y"
  }'

# Test POST - Enable Auto-Print
curl -X POST "YOUR_APEX_URL/trips/auto-print/enable" \
  -H "Content-Type: application/json" \
  -d '{
    "tripId": "TRIP001",
    "tripDate": "2025-11-05",
    "orders": [
      {
        "orderNumber": "ORD001",
        "customerName": "Test Customer",
        "accountNumber": "ACC001",
        "orderDate": "2025-11-05"
      }
    ]
  }'

# Test POST - Update Print Job
curl -X POST "YOUR_APEX_URL/print-jobs/update" \
  -H "Content-Type: application/json" \
  -d '{
    "orderNumber": "ORD001",
    "tripId": "TRIP001",
    "tripDate": "2025-11-05",
    "downloadStatus": "Completed",
    "filePath": "C:\\\\PDFs\\\\ORD001.pdf",
    "fileSizeBytes": 102400
  }'
*/


-- ========================================
-- METHOD 5: TEST WITH POSTMAN
-- ========================================

/*
1. Open Postman
2. Create a new request
3. Set method (GET/POST)
4. Enter URL: YOUR_APEX_URL/endpoint
5. For POST requests:
   - Go to "Body" tab
   - Select "raw"
   - Select "JSON" from dropdown
   - Paste JSON payload
6. Click "Send"
7. View response

EXAMPLE POSTMAN COLLECTION:

Collection: WMS API Tests

Request 1: GET Printer Config
- Method: GET
- URL: {{baseUrl}}/config/printer

Request 2: GET Print Jobs
- Method: GET
- URL: {{baseUrl}}/print-jobs?startDate=2025-11-01

Request 3: POST Save Printer
- Method: POST
- URL: {{baseUrl}}/config/printer
- Body: (JSON payload as shown above)

Variables:
- baseUrl = https://your-apex.com/ords/workspace/wms/v1
*/


-- ========================================
-- VERIFICATION QUERIES
-- ========================================

-- Check if tables have data
SELECT 'Printer Configs' AS table_name, COUNT(*) AS count FROM wms_printer_config
UNION ALL
SELECT 'Trip Configs', COUNT(*) FROM wms_trip_config
UNION ALL
SELECT 'Print Jobs', COUNT(*) FROM wms_print_jobs
UNION ALL
SELECT 'History Records', COUNT(*) FROM wms_print_job_history;


-- View recent print jobs
SELECT
    print_job_id,
    order_number,
    trip_id,
    overall_status,
    TO_CHAR(created_date, 'YYYY-MM-DD HH24:MI:SS') AS created
FROM wms_print_jobs
ORDER BY created_date DESC
FETCH FIRST 10 ROWS ONLY;


-- View trip summary
SELECT
    tc.trip_id,
    TO_CHAR(tc.trip_date, 'YYYY-MM-DD') AS trip_date,
    tc.auto_print_enabled,
    tc.total_orders,
    tc.downloaded_orders,
    tc.printed_orders,
    tc.failed_orders,
    ROUND((tc.printed_orders / NULLIF(tc.total_orders, 0)) * 100, 2) AS completion_pct
FROM wms_trip_config tc
ORDER BY tc.trip_date DESC;


-- View active printer config
SELECT
    config_id,
    printer_name,
    fusion_instance,
    fusion_username,
    auto_download,
    auto_print,
    is_active
FROM wms_printer_config
WHERE is_active = 'Y';


-- ========================================
-- END OF TESTING GUIDE
-- ========================================
