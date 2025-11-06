-- ============================================================================
-- APEX REST ENDPOINT CODE - READY TO COPY/PASTE
-- ============================================================================
-- This file contains the EXACT code to paste into APEX RESTful Services
-- ============================================================================

-- ============================================================================
-- ENDPOINT 1: POST /monitor-printing/enable (UPDATE EXISTING)
-- ============================================================================
-- Instructions:
-- 1. Go to: SQL Workshop > RESTful Services > TRIPMANAGEMENT
-- 2. Find existing: POST monitor-printing/enable
-- 3. Click "Edit Handler"
-- 4. Replace entire "Source" section with code below
-- 5. Click "Apply Changes"
-- ============================================================================

DECLARE
    v_trip_id VARCHAR2(100);
    v_trip_date VARCHAR2(20);
    v_order_count NUMBER;
    v_printer_config_id NUMBER;
    v_printer_name VARCHAR2(200);
    v_orders_json CLOB;
    v_result VARCHAR2(500);
    v_monitor_id NUMBER;
    l_body BLOB;
    v_body CLOB;
BEGIN
    -- Read request body (ORDS 20.x+)
    l_body := :body;
    v_body := UTL_RAW.CAST_TO_VARCHAR2(DBMS_LOB.SUBSTR(l_body, 32000, 1));

    -- Parse JSON body
    APEX_JSON.parse(v_body);

    v_trip_id := APEX_JSON.get_varchar2(p_path => 'tripId');
    v_trip_date := APEX_JSON.get_varchar2(p_path => 'tripDate');
    v_order_count := APEX_JSON.get_number(p_path => 'orderCount');
    v_printer_config_id := APEX_JSON.get_number(p_path => 'printerConfigId');
    v_printer_name := APEX_JSON.get_varchar2(p_path => 'printerName');

    -- Get orders array as JSON string
    v_orders_json := APEX_JSON.get_clob(p_path => 'orders');

    -- Call updated procedure
    wms_enable_monitor_printing_v2(
        p_trip_id => v_trip_id,
        p_trip_date => v_trip_date,
        p_order_count => v_order_count,
        p_printer_config_id => v_printer_config_id,
        p_printer_name => v_printer_name,
        p_orders_json => v_orders_json,
        p_result => v_result,
        p_monitor_id => v_monitor_id
    );

    -- Return result
    IF v_result = 'SUCCESS' THEN
        HTP.p('{"success":true,"message":"Auto-print enabled successfully","monitorId":' || v_monitor_id || '}');
    ELSE
        HTP.p('{"success":false,"error":"' || REPLACE(v_result, '"', '\"') || '"}');
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        HTP.p('{"success":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;

-- ============================================================================
-- ENDPOINT 2: GET /monitor-printing/orders (NEW - CREATE THIS)
-- ============================================================================
-- Instructions:
-- 1. Go to: SQL Workshop > RESTful Services > TRIPMANAGEMENT
-- 2. Click "Create Handler"
-- 3. URI Template: monitor-printing/orders
-- 4. Method: GET
-- 5. Source Type: PL/SQL
-- 6. Add Parameter:
--    - Name: monitorId
--    - Bind Variable: :monitorId
--    - Source Type: Query String
--    - Access Method: IN
--    - Data Type: INT (or leave default)
-- 7. Paste code below in "Source"
-- 8. Click "Create Handler"
-- ============================================================================

DECLARE
    v_cursor SYS_REFCURSOR;
    v_monitor_id NUMBER;

    v_detail_id NUMBER;
    v_order_number VARCHAR2(100);
    v_customer_name VARCHAR2(200);
    v_account_number VARCHAR2(100);
    v_order_date VARCHAR2(20);
    v_pdf_status VARCHAR2(50);
    v_print_status VARCHAR2(50);
    v_pdf_path VARCHAR2(500);
    v_download_attempts NUMBER;
    v_print_attempts NUMBER;
    v_last_error VARCHAR2(1000);
    v_created_date VARCHAR2(30);
    v_last_updated VARCHAR2(30);

    v_first BOOLEAN := TRUE;
BEGIN
    -- Get query parameter
    v_monitor_id := :monitorId;

    -- Call procedure
    wms_get_order_details(
        p_monitor_id => v_monitor_id,
        p_cursor => v_cursor
    );

    -- Build JSON response
    HTP.p('{"items":[');

    LOOP
        FETCH v_cursor INTO
            v_detail_id, v_order_number, v_customer_name, v_account_number,
            v_order_date, v_pdf_status, v_print_status, v_pdf_path,
            v_download_attempts, v_print_attempts, v_last_error,
            v_created_date, v_last_updated;

        EXIT WHEN v_cursor%NOTFOUND;

        IF NOT v_first THEN HTP.p(','); END IF;
        v_first := FALSE;

        HTP.p('{');
        HTP.p('"detailId":' || v_detail_id || ',');
        HTP.p('"orderNumber":"' || REPLACE(v_order_number, '"', '\"') || '",');
        HTP.p('"customerName":"' || REPLACE(v_customer_name, '"', '\"') || '",');
        HTP.p('"accountNumber":"' || REPLACE(v_account_number, '"', '\"') || '",');
        HTP.p('"orderDate":"' || v_order_date || '",');
        HTP.p('"pdfStatus":"' || v_pdf_status || '",');
        HTP.p('"printStatus":"' || v_print_status || '",');
        HTP.p('"pdfPath":"' || COALESCE(REPLACE(v_pdf_path, '"', '\"'), '') || '",');
        HTP.p('"downloadAttempts":' || v_download_attempts || ',');
        HTP.p('"printAttempts":' || v_print_attempts || ',');
        HTP.p('"lastError":"' || COALESCE(REPLACE(v_last_error, '"', '\"'), '') || '",');
        HTP.p('"createdDate":"' || v_created_date || '",');
        HTP.p('"lastUpdated":"' || v_last_updated || '"');
        HTP.p('}');
    END LOOP;

    CLOSE v_cursor;
    HTP.p(']}');
END;

-- ============================================================================
-- ENDPOINT 3: POST /monitor-printing/update-order-status (NEW - CREATE THIS)
-- ============================================================================
-- Instructions:
-- 1. Go to: SQL Workshop > RESTful Services > TRIPMANAGEMENT
-- 2. Click "Create Handler"
-- 3. URI Template: monitor-printing/update-order-status
-- 4. Method: POST
-- 5. Source Type: PL/SQL
-- 6. Paste code below in "Source"
-- 7. Click "Create Handler"
-- ============================================================================

DECLARE
    v_detail_id NUMBER;
    v_pdf_status VARCHAR2(50);
    v_print_status VARCHAR2(50);
    v_pdf_path VARCHAR2(500);
    v_error_message VARCHAR2(1000);
    v_result VARCHAR2(500);
    l_body BLOB;
    v_body CLOB;
BEGIN
    -- Read request body (ORDS 20.x+)
    l_body := :body;
    v_body := UTL_RAW.CAST_TO_VARCHAR2(DBMS_LOB.SUBSTR(l_body, 32000, 1));

    -- Parse JSON body
    APEX_JSON.parse(v_body);

    v_detail_id := APEX_JSON.get_number(p_path => 'detailId');
    v_pdf_status := APEX_JSON.get_varchar2(p_path => 'pdfStatus');
    v_print_status := APEX_JSON.get_varchar2(p_path => 'printStatus');
    v_pdf_path := APEX_JSON.get_varchar2(p_path => 'pdfPath');
    v_error_message := APEX_JSON.get_varchar2(p_path => 'errorMessage');

    -- Call procedure
    wms_update_order_status(
        p_detail_id => v_detail_id,
        p_pdf_status => v_pdf_status,
        p_print_status => v_print_status,
        p_pdf_path => v_pdf_path,
        p_error_message => v_error_message,
        p_result => v_result
    );

    -- Return result
    IF v_result = 'SUCCESS' THEN
        HTP.p('{"success":true,"message":"Order status updated successfully"}');
    ELSE
        HTP.p('{"success":false,"error":"' || REPLACE(v_result, '"', '\"') || '"}');
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        HTP.p('{"success":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;

-- ============================================================================
-- END OF FILE
-- ============================================================================

/*
QUICK TEST URLS:

After creating endpoints, test with these URLs:

1. POST /monitor-printing/enable
   URL: https://your-apex-url/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/monitor-printing/enable
   Body: {
     "tripId": "1412",
     "tripDate": "2025-11-07",
     "orderCount": 19,
     "printerConfigId": 21,
     "printerName": "OneNote (Desktop)",
     "orders": [{"orderNumber": "ORD001", "customerName": "ABC", "accountNumber": "ACC123", "orderDate": "2025-11-07"}]
   }

2. GET /monitor-printing/orders
   URL: https://your-apex-url/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/monitor-printing/orders?monitorId=1

3. POST /monitor-printing/update-order-status
   URL: https://your-apex-url/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/monitor-printing/update-order-status
   Body: {
     "detailId": 1,
     "pdfStatus": "DOWNLOADED",
     "printStatus": "PENDING",
     "pdfPath": "/path/to/pdf.pdf",
     "errorMessage": ""
   }
*/
