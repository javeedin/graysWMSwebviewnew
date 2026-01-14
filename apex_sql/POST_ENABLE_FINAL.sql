-- ============================================================================
-- POST /monitor-printing/enable - FINAL WORKING VERSION
-- ============================================================================
-- Use this AFTER running FIX_PROCEDURE_V2.sql
-- This version properly converts the orders array to JSON string
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
    v_orders_count NUMBER;
BEGIN
    -- Read request body (ORDS 20.x+)
    l_body := :body;
    v_body := UTL_RAW.CAST_TO_VARCHAR2(DBMS_LOB.SUBSTR(l_body, 32000, 1));

    -- Parse JSON body
    APEX_JSON.parse(v_body);

    -- Get trip-level fields
    v_trip_id := APEX_JSON.get_varchar2(p_path => 'tripId');
    v_trip_date := APEX_JSON.get_varchar2(p_path => 'tripDate');
    v_order_count := APEX_JSON.get_number(p_path => 'orderCount');
    v_printer_config_id := APEX_JSON.get_number(p_path => 'printerConfigId');
    v_printer_name := APEX_JSON.get_varchar2(p_path => 'printerName');

    -- ✅ IMPORTANT: Convert orders array to JSON string manually
    -- Get count of orders
    v_orders_count := APEX_JSON.get_count(p_path => 'orders');

    IF v_orders_count > 0 THEN
        -- Build JSON array string manually
        v_orders_json := '[';

        FOR i IN 1 .. v_orders_count LOOP
            IF i > 1 THEN
                v_orders_json := v_orders_json || ',';
            END IF;

            v_orders_json := v_orders_json || '{';
            v_orders_json := v_orders_json || '"orderNumber":"' || APEX_JSON.get_varchar2(p_path => 'orders[%d].orderNumber', p0 => i) || '",';
            v_orders_json := v_orders_json || '"customerName":"' || REPLACE(APEX_JSON.get_varchar2(p_path => 'orders[%d].customerName', p0 => i), '"', '\"') || '",';
            v_orders_json := v_orders_json || '"accountNumber":"' || APEX_JSON.get_varchar2(p_path => 'orders[%d].accountNumber', p0 => i) || '",';
            v_orders_json := v_orders_json || '"orderDate":"' || APEX_JSON.get_varchar2(p_path => 'orders[%d].orderDate', p0 => i) || '"';
            v_orders_json := v_orders_json || '}';
        END LOOP;

        v_orders_json := v_orders_json || ']';
    END IF;

    -- Call the V2 procedure
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
        HTP.p('{"success":true,"message":"Auto-print enabled successfully","monitorId":' || v_monitor_id || ',"ordersProcessed":' || v_orders_count || '}');
    ELSE
        HTP.p('{"success":false,"error":"' || REPLACE(v_result, '"', '\"') || '"}');
    END IF;

EXCEPTION
    WHEN OTHERS THEN
        HTP.p('{"success":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;

-- ============================================================================
-- SETUP STEPS:
-- ============================================================================
-- 1. Run: FIX_PROCEDURE_V2.sql (creates/replaces the procedure)
-- 2. Update POST /monitor-printing/enable endpoint with code above
-- 3. Test with sample JSON below
-- ============================================================================

-- ============================================================================
-- TEST JSON (USE THIS IN POSTMAN):
-- ============================================================================
/*
POST https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/monitor-printing/enable

Headers:
Content-Type: application/json

Body:
{
  "tripId": "TEST123",
  "tripDate": "2025-11-07",
  "orderCount": 2,
  "printerConfigId": 21,
  "printerName": "Test Printer",
  "orders": [
    {
      "orderNumber": "ORD001",
      "customerName": "Customer ABC",
      "accountNumber": "ACC123",
      "orderDate": "2025-11-07"
    },
    {
      "orderNumber": "ORD002",
      "customerName": "Customer XYZ",
      "accountNumber": "ACC456",
      "orderDate": "2025-11-07"
    }
  ]
}

Expected Response:
{
  "success": true,
  "message": "Auto-print enabled successfully",
  "monitorId": 1,
  "ordersProcessed": 2
}
*/

-- ============================================================================
-- VERIFY DATA WAS SAVED:
-- ============================================================================
/*
-- Check trip
SELECT * FROM wms_monitor_printing WHERE trip_id = 'TEST123';

-- Check orders
SELECT
    m.trip_id,
    m.monitor_id,
    d.detail_id,
    d.order_number,
    d.customer_name,
    d.account_number,
    d.pdf_status,
    d.print_status
FROM wms_monitor_printing m
JOIN wms_monitor_printing_details d ON m.monitor_id = d.monitor_id
WHERE m.trip_id = 'TEST123'
ORDER BY d.order_number;

-- Should show 2 rows: ORD001 and ORD002
*/
