-- POST /monitor-printing/enable
-- Version: BLOB to CLOB conversion using UTL_RAW

DECLARE
    v_trip_id VARCHAR2(200);
    v_trip_date VARCHAR2(50);
    v_order_count NUMBER;
    v_printer_config_id NUMBER;
    v_printer_name VARCHAR2(500);
    v_orders_json CLOB;
    v_result VARCHAR2(4000);
    v_monitor_id NUMBER;
    v_body_clob CLOB;
    v_body_blob BLOB;
    v_dest_offset INTEGER := 1;
    v_src_offset INTEGER := 1;
    v_lang_context INTEGER := DBMS_LOB.DEFAULT_LANG_CTX;
    v_warning INTEGER;
BEGIN
    -- Get BLOB body
    v_body_blob := :body;

    -- Convert BLOB to CLOB
    BEGIN
        DBMS_LOB.CREATETEMPORARY(v_body_clob, TRUE);
        DBMS_LOB.CONVERTTOCLOB(
            dest_lob => v_body_clob,
            src_blob => v_body_blob,
            amount => DBMS_LOB.LOBMAXSIZE,
            dest_offset => v_dest_offset,
            src_offset => v_src_offset,
            blob_csid => DBMS_LOB.DEFAULT_CSID,
            lang_context => v_lang_context,
            warning => v_warning
        );

        -- Debug: Log converted body length
        DBMS_OUTPUT.PUT_LINE('Body converted, length: ' || DBMS_LOB.GETLENGTH(v_body_clob));

    EXCEPTION WHEN OTHERS THEN
        HTP.p('{"success":false,"error":"BLOB to CLOB conversion failed: ' || REPLACE(SQLERRM, '"', '\"') || '"}');
        RETURN;
    END;

    -- Parse JSON from CLOB
    BEGIN
        APEX_JSON.parse(v_body_clob);

        v_trip_id := APEX_JSON.get_varchar2(p_path => 'tripId');
        v_trip_date := APEX_JSON.get_varchar2(p_path => 'tripDate');
        v_order_count := APEX_JSON.get_number(p_path => 'orderCount');
        v_printer_config_id := APEX_JSON.get_number(p_path => 'printerConfigId');
        v_printer_name := APEX_JSON.get_varchar2(p_path => 'printerName');
        v_orders_json := APEX_JSON.get_clob(p_path => 'orders');

        DBMS_OUTPUT.PUT_LINE('Parsed tripId: ' || v_trip_id);

    EXCEPTION WHEN OTHERS THEN
        HTP.p('{"success":false,"error":"JSON parsing failed: ' || REPLACE(SQLERRM, '"', '\"') || '"}');
        DBMS_LOB.FREETEMPORARY(v_body_clob);
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

    EXCEPTION WHEN OTHERS THEN
        HTP.p('{"success":false,"error":"Procedure error: ' || REPLACE(SQLERRM, '"', '\"') || '"}');
        DBMS_LOB.FREETEMPORARY(v_body_clob);
        RETURN;
    END;

    -- Clean up temporary CLOB
    DBMS_LOB.FREETEMPORARY(v_body_clob);

    -- Return result
    IF v_result = 'SUCCESS' THEN
        HTP.p('{"success":true,"message":"Auto-print enabled successfully","monitorId":' || v_monitor_id || '}');
    ELSE
        HTP.p('{"success":false,"error":"' || REPLACE(v_result, '"', '\"') || '"}');
    END IF;

EXCEPTION
    WHEN OTHERS THEN
        HTP.p('{"success":false,"error":"Unexpected error: ' || REPLACE(SQLERRM, '"', '\"') || '"}');
        IF DBMS_LOB.ISTEMPORARY(v_body_clob) = 1 THEN
            DBMS_LOB.FREETEMPORARY(v_body_clob);
        END IF;
END;
