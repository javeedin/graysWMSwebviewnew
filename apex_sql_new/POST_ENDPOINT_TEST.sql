-- TEST VERSION: Just echo back the parsed values to identify the issue
-- Use this temporarily to see if JSON parsing works

DECLARE
    v_trip_id VARCHAR2(200);
    v_trip_date VARCHAR2(50);
    v_order_count NUMBER;
    v_printer_config_id NUMBER;
    v_printer_name VARCHAR2(500);
    v_orders_json CLOB;
    l_body CLOB;
BEGIN
    -- Try to read the body
    BEGIN
        -- OPTION 1: Try :body_text first (direct CLOB)
        l_body := :body_text;
    EXCEPTION WHEN OTHERS THEN
        -- OPTION 2: If that fails, convert from BLOB
        BEGIN
            l_body := UTL_RAW.CAST_TO_VARCHAR2(DBMS_LOB.SUBSTR(:body, 32000, 1));
        EXCEPTION WHEN OTHERS THEN
            HTP.p('{"success":false,"error":"Cannot read request body"}');
            RETURN;
        END;
    END;

    -- Parse JSON
    BEGIN
        APEX_JSON.parse(l_body);

        v_trip_id := APEX_JSON.get_varchar2(p_path => 'tripId');
        v_trip_date := APEX_JSON.get_varchar2(p_path => 'tripDate');
        v_order_count := APEX_JSON.get_number(p_path => 'orderCount');
        v_printer_config_id := APEX_JSON.get_number(p_path => 'printerConfigId');
        v_printer_name := APEX_JSON.get_varchar2(p_path => 'printerName');
        v_orders_json := APEX_JSON.get_clob(p_path => 'orders');

        -- Echo back what we parsed (TEST ONLY)
        HTP.p('{');
        HTP.p('"success":true,');
        HTP.p('"message":"JSON parsed successfully",');
        HTP.p('"parsed":{');
        HTP.p('"tripId":"' || v_trip_id || '",');
        HTP.p('"tripDate":"' || v_trip_date || '",');
        HTP.p('"orderCount":' || v_order_count || ',');
        HTP.p('"printerConfigId":' || v_printer_config_id || ',');
        HTP.p('"printerName":"' || v_printer_name || '",');
        HTP.p('"ordersJsonLength":' || LENGTH(v_orders_json));
        HTP.p('}');
        HTP.p('}');

    EXCEPTION WHEN OTHERS THEN
        HTP.p('{"success":false,"error":"JSON parsing error: ' || REPLACE(SQLERRM, '"', '\"') || '"}');
    END;

EXCEPTION
    WHEN OTHERS THEN
        HTP.p('{"success":false,"error":"Unexpected error: ' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
