-- ALTERNATIVE VERSION: Use APEX_JSON.parse with BLOB directly
-- Some ORDS versions handle this better

DECLARE
    v_trip_id VARCHAR2(200);
    v_trip_date VARCHAR2(50);
    v_order_count NUMBER;
    v_printer_config_id NUMBER;
    v_printer_name VARCHAR2(500);
    v_orders_json CLOB;
    v_result VARCHAR2(4000);
    v_monitor_id NUMBER;
BEGIN
    -- Parse JSON directly from :body (BLOB)
    -- APEX_JSON.parse can handle BLOB automatically in newer versions
    BEGIN
        APEX_JSON.parse(:body);

        v_trip_id := APEX_JSON.get_varchar2(p_path => 'tripId');
        v_trip_date := APEX_JSON.get_varchar2(p_path => 'tripDate');
        v_order_count := APEX_JSON.get_number(p_path => 'orderCount');
        v_printer_config_id := APEX_JSON.get_number(p_path => 'printerConfigId');
        v_printer_name := APEX_JSON.get_varchar2(p_path => 'printerName');
        v_orders_json := APEX_JSON.get_clob(p_path => 'orders');

    EXCEPTION WHEN OTHERS THEN
        HTP.p('{"success":false,"error":"JSON parsing failed: ' || REPLACE(SQLERRM, '"', '\"') || '"}');
        RETURN;
    END;

    -- Call the procedure
    BEGIN
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

    EXCEPTION WHEN OTHERS THEN
        HTP.p('{"success":false,"error":"Procedure error: ' || REPLACE(SQLERRM, '"', '\"') || '"}');
        RETURN;
    END;

    -- Return result
    IF v_result = 'SUCCESS' THEN
        HTP.p('{"success":true,"message":"Auto-print enabled successfully","monitorId":' || v_monitor_id || '}');
    ELSE
        HTP.p('{"success":false,"error":"' || REPLACE(v_result, '"', '\"') || '"}');
    END IF;

EXCEPTION
    WHEN OTHERS THEN
        HTP.p('{"success":false,"error":"Unexpected error: ' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
