-- ============================================================================
-- POST /monitor-printing/enable - CORRECT VERSION WITH V2 PROCEDURE
-- ============================================================================
-- This calls wms_enable_monitor_printing_v2 which saves trip + orders
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

    -- ✅ CALL THE V2 PROCEDURE (with orders support)
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
-- VERIFICATION SQL - Run this to check procedure exists
-- ============================================================================

-- Check if V2 procedure exists
SELECT object_name, object_type, status
FROM user_objects
WHERE object_name = 'WMS_ENABLE_MONITOR_PRINTING_V2';

-- If it doesn't exist, you need to run: 09_monitor_printing_details.sql

-- ============================================================================
-- TEST REQUEST
-- ============================================================================

/*
POST https://your-apex-url/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/monitor-printing/enable

Headers:
Content-Type: application/json

Body:
{
  "tripId": "1412",
  "tripDate": "2025-11-07",
  "orderCount": 2,
  "printerConfigId": 21,
  "printerName": "OneNote (Desktop)",
  "orders": [
    {
      "orderNumber": "ORD001",
      "customerName": "Customer ABC",
      "accountNumber": "ACC123",
      "orderDate": "2025-11-07",
      "tripId": "1412",
      "tripDate": "2025-11-07"
    },
    {
      "orderNumber": "ORD002",
      "customerName": "Customer XYZ",
      "accountNumber": "ACC456",
      "orderDate": "2025-11-07",
      "tripId": "1412",
      "tripDate": "2025-11-07"
    }
  ]
}

Expected Response:
{
  "success": true,
  "message": "Auto-print enabled successfully",
  "monitorId": 1
}
*/

-- ============================================================================
-- AFTER TESTING - VERIFY DATA WAS SAVED
-- ============================================================================

-- Check trip was saved
SELECT * FROM wms_monitor_printing WHERE trip_id = '1412';

-- Check orders were saved
SELECT
    d.detail_id,
    d.order_number,
    d.customer_name,
    d.pdf_status,
    d.print_status
FROM wms_monitor_printing m
JOIN wms_monitor_printing_details d ON m.monitor_id = d.monitor_id
WHERE m.trip_id = '1412'
ORDER BY d.order_number;

-- Should show 2 orders: ORD001 and ORD002
