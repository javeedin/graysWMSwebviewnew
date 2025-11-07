-- GET /monitor-printing/orders?trip_id=XXX
-- Returns just the FIRST order for testing

DECLARE
    v_trip_id VARCHAR2(200);
    v_detail_id NUMBER;
    v_order_number VARCHAR2(100);
    v_customer_name VARCHAR2(500);
    v_account_number VARCHAR2(100);
    v_order_date VARCHAR2(20);
    v_pdf_status VARCHAR2(50);
    v_print_status VARCHAR2(50);
    v_json VARCHAR2(4000);
BEGIN
    -- Get trip_id parameter
    v_trip_id := :trip_id;

    -- Validate parameter
    IF v_trip_id IS NULL THEN
        HTP.p('{"items":[],"error":"trip_id parameter is required"}');
        RETURN;
    END IF;

    -- Get just the first order
    BEGIN
        SELECT
            detail_id,
            order_number,
            customer_name,
            account_number,
            order_date,
            pdf_status,
            print_status
        INTO
            v_detail_id,
            v_order_number,
            v_customer_name,
            v_account_number,
            v_order_date,
            v_pdf_status,
            v_print_status
        FROM (
            SELECT * FROM wms_monitor_printing_details
            WHERE trip_id = v_trip_id
            ORDER BY order_number
        )
        WHERE ROWNUM = 1;

        -- Build JSON for this one order
        v_json := '{"items":[{';
        v_json := v_json || '"detailId":' || v_detail_id || ',';
        v_json := v_json || '"orderNumber":"' || v_order_number || '",';
        v_json := v_json || '"customerName":"' || v_customer_name || '",';
        v_json := v_json || '"accountNumber":"' || v_account_number || '",';
        v_json := v_json || '"orderDate":"' || v_order_date || '",';
        v_json := v_json || '"pdfStatus":"' || v_pdf_status || '",';
        v_json := v_json || '"printStatus":"' || v_print_status || '"';
        v_json := v_json || '}]}';

        HTP.p(v_json);

    EXCEPTION WHEN NO_DATA_FOUND THEN
        HTP.p('{"items":[]}');
    WHEN OTHERS THEN
        HTP.p('{"items":[],"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
    END;

EXCEPTION
    WHEN OTHERS THEN
        HTP.p('{"items":[],"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
