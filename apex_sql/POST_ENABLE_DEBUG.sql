-- ============================================================================
-- POST /monitor-printing/enable - DEBUG VERSION
-- ============================================================================
-- This version will show exactly where the error occurs
-- Use this TEMPORARILY to debug, then switch back to normal version
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
    v_debug_step VARCHAR2(100);
BEGIN
    v_debug_step := 'Reading body';

    -- Read request body (ORDS 20.x+)
    l_body := :body;
    v_body := UTL_RAW.CAST_TO_VARCHAR2(DBMS_LOB.SUBSTR(l_body, 32000, 1));

    v_debug_step := 'Body size: ' || LENGTH(v_body);

    -- Check if body is empty
    IF v_body IS NULL OR LENGTH(v_body) = 0 THEN
        HTP.p('{"success":false,"error":"Request body is empty"}');
        RETURN;
    END IF;

    v_debug_step := 'Parsing JSON';

    -- Parse JSON body
    BEGIN
        APEX_JSON.parse(v_body);
    EXCEPTION
        WHEN OTHERS THEN
            HTP.p('{"success":false,"error":"JSON parse failed: ' || REPLACE(SQLERRM, '"', '\"') || '"}');
            RETURN;
    END;

    v_debug_step := 'Getting tripId';
    BEGIN
        v_trip_id := APEX_JSON.get_varchar2(p_path => 'tripId');
    EXCEPTION
        WHEN OTHERS THEN
            HTP.p('{"success":false,"error":"Failed to get tripId: ' || REPLACE(SQLERRM, '"', '\"') || '"}');
            RETURN;
    END;

    v_debug_step := 'Getting tripDate';
    BEGIN
        v_trip_date := APEX_JSON.get_varchar2(p_path => 'tripDate');
    EXCEPTION
        WHEN OTHERS THEN
            HTP.p('{"success":false,"error":"Failed to get tripDate: ' || REPLACE(SQLERRM, '"', '\"') || '"}');
            RETURN;
    END;

    v_debug_step := 'Getting orderCount';
    BEGIN
        v_order_count := APEX_JSON.get_number(p_path => 'orderCount');
    EXCEPTION
        WHEN OTHERS THEN
            HTP.p('{"success":false,"error":"Failed to get orderCount: ' || REPLACE(SQLERRM, '"', '\"') || '"}');
            RETURN;
    END;

    v_debug_step := 'Getting printerConfigId';
    BEGIN
        v_printer_config_id := APEX_JSON.get_number(p_path => 'printerConfigId');
    EXCEPTION
        WHEN OTHERS THEN
            HTP.p('{"success":false,"error":"Failed to get printerConfigId: ' || REPLACE(SQLERRM, '"', '\"') || '. Value: ' || APEX_JSON.get_varchar2(p_path => 'printerConfigId') || '"}');
            RETURN;
    END;

    v_debug_step := 'Getting printerName';
    BEGIN
        v_printer_name := APEX_JSON.get_varchar2(p_path => 'printerName');
    EXCEPTION
        WHEN OTHERS THEN
            HTP.p('{"success":false,"error":"Failed to get printerName: ' || REPLACE(SQLERRM, '"', '\"') || '"}');
            RETURN;
    END;

    v_debug_step := 'Getting orders array';
    BEGIN
        -- Try to get orders as CLOB
        v_orders_json := APEX_JSON.get_clob(p_path => 'orders');

        -- If null, try as VARCHAR2
        IF v_orders_json IS NULL THEN
            v_orders_json := APEX_JSON.get_varchar2(p_path => 'orders');
        END IF;

    EXCEPTION
        WHEN OTHERS THEN
            HTP.p('{"success":false,"error":"Failed to get orders: ' || REPLACE(SQLERRM, '"', '\"') || '"}');
            RETURN;
    END;

    -- Debug output
    HTP.p('{"debug":{');
    HTP.p('"step":"' || v_debug_step || '",');
    HTP.p('"tripId":"' || v_trip_id || '",');
    HTP.p('"tripDate":"' || v_trip_date || '",');
    HTP.p('"orderCount":' || v_order_count || ',');
    HTP.p('"printerConfigId":' || v_printer_config_id || ',');
    HTP.p('"printerName":"' || v_printer_name || '",');
    HTP.p('"ordersJsonLength":' || NVL(LENGTH(v_orders_json), 0) || ',');
    HTP.p('"ordersJsonPreview":"' || SUBSTR(v_orders_json, 1, 100) || '"');
    HTP.p('}}');

    -- DON'T call procedure yet - just return debug info

EXCEPTION
    WHEN OTHERS THEN
        HTP.p('{"success":false,"error":"Error at step: ' || v_debug_step || ' - ' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;

-- ============================================================================
-- HOW TO USE THIS DEBUG VERSION:
-- ============================================================================
-- 1. Replace your POST /monitor-printing/enable code with this
-- 2. Make a test request with Postman
-- 3. Look at the response - it will show:
--    - Which step failed
--    - What values were parsed
--    - Length of orders JSON
-- 4. Share the response with me
-- 5. After debugging, switch back to normal code
-- ============================================================================
