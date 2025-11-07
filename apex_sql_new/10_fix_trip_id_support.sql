-- ============================================================================
-- FIX: Add trip_id support to wms_monitor_printing_details
-- ============================================================================
-- This file adds trip_id column and updates procedures to use trip_id
-- for joining between wms_monitor_printing and wms_monitor_printing_details
-- ============================================================================

-- ============================================================================
-- STEP 1: Add trip_id column to wms_monitor_printing_details
-- ============================================================================

-- Add trip_id column (nullable initially for existing data)
ALTER TABLE wms_monitor_printing_details
ADD trip_id VARCHAR2(100);

-- Create index for faster queries
CREATE INDEX idx_details_trip_id ON wms_monitor_printing_details(trip_id);

-- Backfill existing data (populate trip_id from parent wms_monitor_printing table)
UPDATE wms_monitor_printing_details d
SET trip_id = (
    SELECT m.trip_id
    FROM wms_monitor_printing m
    WHERE m.monitor_id = d.monitor_id
)
WHERE trip_id IS NULL;

COMMIT;

-- ============================================================================
-- STEP 2: Updated procedure to enable monitor printing with trip_id
-- ============================================================================

CREATE OR REPLACE PROCEDURE wms_enable_monitor_printing_v3 (
    p_trip_id IN VARCHAR2,
    p_trip_date IN VARCHAR2,
    p_order_count IN NUMBER,
    p_printer_config_id IN NUMBER,
    p_printer_name IN VARCHAR2,
    p_orders_json IN CLOB,  -- JSON array of orders
    p_result OUT VARCHAR2,
    p_monitor_id OUT NUMBER
) AS
    v_trip_date_parsed DATE;
    v_existing_count NUMBER;
    v_monitor_id NUMBER;
    v_orders_array JSON_ARRAY_T;
    v_order JSON_OBJECT_T;
    v_order_number VARCHAR2(100);
    v_customer_name VARCHAR2(200);
    v_account_number VARCHAR2(100);
    v_order_date DATE;
BEGIN
    -- Parse trip date
    BEGIN
        v_trip_date_parsed := TO_DATE(p_trip_date, 'YYYY-MM-DD');
    EXCEPTION
        WHEN OTHERS THEN
            p_result := 'ERROR: Invalid date format. Use YYYY-MM-DD';
            RETURN;
    END;

    -- Check if already exists
    SELECT COUNT(*), MAX(monitor_id)
    INTO v_existing_count, v_monitor_id
    FROM wms_monitor_printing
    WHERE trip_id = p_trip_id
      AND trip_date = v_trip_date_parsed;

    IF v_existing_count > 0 THEN
        -- Update existing trip
        UPDATE wms_monitor_printing
        SET order_count = p_order_count,
            printer_config_id = p_printer_config_id,
            printer_name = p_printer_name,
            status = 'PENDING_DOWNLOAD',
            last_updated = CURRENT_TIMESTAMP
        WHERE monitor_id = v_monitor_id;

        -- Delete old order details
        DELETE FROM wms_monitor_printing_details
        WHERE monitor_id = v_monitor_id;
    ELSE
        -- Insert new trip
        INSERT INTO wms_monitor_printing (
            trip_id, trip_date, order_count, printer_config_id,
            printer_name, status, enabled_by
        ) VALUES (
            p_trip_id, v_trip_date_parsed, p_order_count, p_printer_config_id,
            p_printer_name, 'PENDING_DOWNLOAD', USER
        ) RETURNING monitor_id INTO v_monitor_id;
    END IF;

    -- Parse and insert order details
    IF p_orders_json IS NOT NULL AND LENGTH(p_orders_json) > 0 THEN
        BEGIN
            v_orders_array := JSON_ARRAY_T.parse(p_orders_json);

            FOR i IN 0 .. v_orders_array.get_size - 1 LOOP
                v_order := JSON_OBJECT_T(v_orders_array.get(i));

                v_order_number := v_order.get_string('orderNumber');
                v_customer_name := v_order.get_string('customerName');
                v_account_number := v_order.get_string('accountNumber');

                -- Parse order date
                BEGIN
                    v_order_date := TO_DATE(v_order.get_string('orderDate'), 'YYYY-MM-DD');
                EXCEPTION
                    WHEN OTHERS THEN
                        v_order_date := v_trip_date_parsed;
                END;

                -- ✅ FIX: Now also storing trip_id in details table
                INSERT INTO wms_monitor_printing_details (
                    monitor_id,
                    trip_id,           -- ✅ NEW: Store trip_id
                    order_number,
                    customer_name,
                    account_number,
                    order_date,
                    pdf_status,
                    print_status
                ) VALUES (
                    v_monitor_id,
                    p_trip_id,         -- ✅ NEW: Use trip_id parameter
                    v_order_number,
                    v_customer_name,
                    v_account_number,
                    v_order_date,
                    'PENDING',
                    'PENDING'
                );
            END LOOP;
        EXCEPTION
            WHEN OTHERS THEN
                ROLLBACK;
                p_result := 'ERROR: Failed to parse orders: ' || SQLERRM;
                RETURN;
        END;
    END IF;

    COMMIT;
    p_result := 'SUCCESS';
    p_monitor_id := v_monitor_id;

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        p_result := 'ERROR: ' || SQLERRM;
END wms_enable_monitor_printing_v3;
/

-- ============================================================================
-- STEP 3: Updated procedure to get order details by trip_id (not monitor_id)
-- ============================================================================

CREATE OR REPLACE PROCEDURE wms_get_order_details_by_trip (
    p_trip_id IN VARCHAR2,
    p_cursor OUT SYS_REFCURSOR
) AS
BEGIN
    OPEN p_cursor FOR
    SELECT
        detail_id,
        order_number,
        customer_name,
        account_number,
        TO_CHAR(order_date, 'YYYY-MM-DD') AS order_date,
        pdf_status,
        print_status,
        pdf_path,
        download_attempts,
        print_attempts,
        last_error,
        TO_CHAR(created_date, 'YYYY-MM-DD HH24:MI:SS') AS created_date,
        TO_CHAR(last_updated, 'YYYY-MM-DD HH24:MI:SS') AS last_updated
    FROM wms_monitor_printing_details
    WHERE trip_id = p_trip_id  -- ✅ FIX: Query by trip_id instead of monitor_id
    ORDER BY order_number;
END wms_get_order_details_by_trip;
/

-- ============================================================================
-- STEP 4: APEX REST API Endpoints (Copy to APEX RESTful Services)
-- ============================================================================

/*
-- ----------------------------------------------------------------------------
-- ENDPOINT 1: POST /monitor-printing/enable (UPDATED)
-- ----------------------------------------------------------------------------
-- Method: POST
-- Source Type: PL/SQL
-- Copy this code to APEX RESTful Services > Your Module > /monitor-printing/enable
-- Source:

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

    -- Call updated procedure with trip_id support
    wms_enable_monitor_printing_v3(
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

-- ----------------------------------------------------------------------------
-- ENDPOINT 2: GET /monitor-printing/orders (UPDATED)
-- ----------------------------------------------------------------------------
-- Method: GET
-- Source Type: PL/SQL
-- Parameters: trip_id (Query String) ✅ CHANGED from monitorId to trip_id
-- Copy this code to APEX RESTful Services > Your Module > /monitor-printing/orders
-- Source:

DECLARE
    v_cursor SYS_REFCURSOR;
    v_trip_id VARCHAR2(100);

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
    -- ✅ FIX: Get trip_id parameter instead of monitorId
    v_trip_id := :trip_id;

    -- Call updated procedure that queries by trip_id
    wms_get_order_details_by_trip(
        p_trip_id => v_trip_id,
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
EXCEPTION
    WHEN OTHERS THEN
        HTP.p('{"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;

*/

-- ============================================================================
-- STEP 5: Verification Queries
-- ============================================================================

-- Verify trip_id column was added
SELECT column_name, data_type, nullable
FROM user_tab_columns
WHERE table_name = 'WMS_MONITOR_PRINTING_DETAILS'
ORDER BY column_id;

-- Check if trip_id is populated
SELECT
    COUNT(*) as total_records,
    COUNT(trip_id) as records_with_trip_id,
    COUNT(*) - COUNT(trip_id) as records_missing_trip_id
FROM wms_monitor_printing_details;

-- Sample data verification
SELECT
    d.detail_id,
    d.monitor_id,
    d.trip_id as detail_trip_id,
    m.trip_id as monitor_trip_id,
    d.order_number,
    d.customer_name
FROM wms_monitor_printing_details d
LEFT JOIN wms_monitor_printing m ON d.monitor_id = m.monitor_id
WHERE ROWNUM <= 10;

-- ============================================================================
-- END OF FILE
-- ============================================================================

/*
IMPLEMENTATION STEPS:

1. Run STEP 1 in SQL Developer/SQL*Plus to add trip_id column

2. Run STEP 2 to create wms_enable_monitor_printing_v3 procedure

3. Run STEP 3 to create wms_get_order_details_by_trip procedure

4. In APEX RESTful Services:
   a) Update POST /monitor-printing/enable endpoint:
      - Copy the PL/SQL code from ENDPOINT 1 section above
      - Replace existing code

   b) Update GET /monitor-printing/orders endpoint:
      - Change parameter name from 'monitorId' to 'trip_id'
      - Copy the PL/SQL code from ENDPOINT 2 section above
      - Replace existing code

5. Run STEP 5 verification queries to confirm everything is working

6. No JavaScript changes needed - already sends trip_id!

TESTING:

Test POST:
{
  "tripId": "TRIP123",
  "tripDate": "2025-11-06",
  "orderCount": 5,
  "printerConfigId": 1,
  "printerName": "HP LaserJet",
  "orders": [
    {"orderNumber": "ORD001", "customerName": "Customer A", "accountNumber": "ACC001", "orderDate": "2025-11-06"},
    {"orderNumber": "ORD002", "customerName": "Customer B", "accountNumber": "ACC002", "orderDate": "2025-11-06"}
  ]
}

Test GET:
/monitor-printing/orders?trip_id=TRIP123

Should return all orders for TRIP123
*/
