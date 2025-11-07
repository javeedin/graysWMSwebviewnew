-- APEX POST Endpoint: /monitor-printing/enable
-- More robust version with better error handling

DECLARE
    v_trip_id VARCHAR2(200);      -- Increased size
    v_trip_date VARCHAR2(50);     -- Increased size
    v_order_count NUMBER;
    v_printer_config_id NUMBER;
    v_printer_name VARCHAR2(500); -- Increased size
    v_orders_json CLOB;
    v_result VARCHAR2(4000);      -- Increased size for error messages
    v_monitor_id NUMBER;
    l_body CLOB;
BEGIN
    -- Read request body - direct CLOB conversion (more robust than BLOB)
    l_body := :body_text;  -- Use :body_text instead of :body for direct CLOB

    -- If :body_text doesn't work, try this alternative:
    -- l_body := APEX_UTIL.BLOB_TO_CLOB(:body);

    -- Debug: Log what we received
    DBMS_OUTPUT.PUT_LINE('Request body length: ' || LENGTH(l_body));
    DBMS_OUTPUT.PUT_LINE('Request body: ' || SUBSTR(l_body, 1, 500));

    -- Parse JSON body
    BEGIN
        APEX_JSON.parse(l_body);

        v_trip_id := APEX_JSON.get_varchar2(p_path => 'tripId');
        v_trip_date := APEX_JSON.get_varchar2(p_path => 'tripDate');
        v_order_count := APEX_JSON.get_number(p_path => 'orderCount');
        v_printer_config_id := APEX_JSON.get_number(p_path => 'printerConfigId');
        v_printer_name := APEX_JSON.get_varchar2(p_path => 'printerName');

        -- Get orders array as CLOB
        v_orders_json := APEX_JSON.get_clob(p_path => 'orders');

        DBMS_OUTPUT.PUT_LINE('Parsed tripId: ' || v_trip_id);
        DBMS_OUTPUT.PUT_LINE('Parsed printerConfigId: ' || v_printer_config_id);
        DBMS_OUTPUT.PUT_LINE('Orders JSON length: ' || LENGTH(v_orders_json));

    EXCEPTION
        WHEN OTHERS THEN
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

        DBMS_OUTPUT.PUT_LINE('Procedure result: ' || v_result);
        DBMS_OUTPUT.PUT_LINE('Monitor ID: ' || v_monitor_id);

    EXCEPTION
        WHEN OTHERS THEN
            HTP.p('{"success":false,"error":"Procedure call failed: ' || REPLACE(SQLERRM, '"', '\"') || '"}');
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
