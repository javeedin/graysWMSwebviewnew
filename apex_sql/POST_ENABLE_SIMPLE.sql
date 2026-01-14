-- ============================================================================
-- POST /monitor-printing/enable - SIMPLE VERSION (NO ORDERS)
-- ============================================================================
-- This version uses the OLD procedure without orders support
-- Use this to test if the basic flow works
-- ============================================================================

DECLARE
    v_trip_id VARCHAR2(100);
    v_trip_date VARCHAR2(20);
    v_order_count NUMBER;
    v_printer_config_id NUMBER;
    v_printer_name VARCHAR2(200);
    v_result VARCHAR2(500);
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

    -- ⚠️ USING OLD PROCEDURE (without orders)
    wms_enable_monitor_printing(
        p_trip_id => v_trip_id,
        p_trip_date => v_trip_date,
        p_order_count => v_order_count,
        p_printer_config_id => v_printer_config_id,
        p_printer_name => v_printer_name,
        p_result => v_result
    );

    -- Return result
    IF v_result = 'SUCCESS' THEN
        HTP.p('{"success":true,"message":"Trip saved (no orders)"}');
    ELSE
        HTP.p('{"success":false,"error":"' || REPLACE(v_result, '"', '\"') || '"}');
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        HTP.p('{"success":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;

-- ============================================================================
-- TEST REQUEST (without orders array)
-- ============================================================================
/*
POST https://your-apex-url/ords/WKSP_GRAYSAPP/TRIPMANAGEMENT/monitor-printing/enable

{
  "tripId": "TEST123",
  "tripDate": "2025-11-07",
  "orderCount": 2,
  "printerConfigId": 21,
  "printerName": "Test Printer"
}

Note: NO "orders" array in this test!

Expected: {"success":true,"message":"Trip saved (no orders)"}
*/
