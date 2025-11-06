-- GET /monitor-printing/orders?trip_id=XXX
-- Build JSON in CLOB variable, then output once

DECLARE
    v_trip_id VARCHAR2(200);
    v_json CLOB;
    v_first_row BOOLEAN := TRUE;

    CURSOR c_orders IS
        SELECT
            detail_id,
            order_number,
            customer_name,
            account_number,
            order_date,
            pdf_status,
            print_status,
            pdf_path,
            error_message
        FROM wms_monitor_printing_details
        WHERE trip_id = v_trip_id
        ORDER BY order_number;

    v_rec c_orders%ROWTYPE;
BEGIN
    -- Get trip_id parameter
    v_trip_id := :trip_id;

    -- Validate parameter
    IF v_trip_id IS NULL THEN
        HTP.p('{"items":[],"error":"trip_id parameter is required"}');
        RETURN;
    END IF;

    DBMS_OUTPUT.PUT_LINE('GET orders for trip_id: ' || v_trip_id);

    -- Initialize JSON string
    v_json := '{"items":[';

    -- Loop through orders and build JSON array
    OPEN c_orders;

    LOOP
        FETCH c_orders INTO v_rec;
        EXIT WHEN c_orders%NOTFOUND;

        -- Add comma between items
        IF NOT v_first_row THEN
            v_json := v_json || ',';
        END IF;
        v_first_row := FALSE;

        -- Build JSON object for this order
        v_json := v_json || '{';
        v_json := v_json || '"detailId":' || NVL(TO_CHAR(v_rec.detail_id), 'null') || ',';
        v_json := v_json || '"orderNumber":"' || REPLACE(NVL(v_rec.order_number, ''), '"', '\"') || '",';
        v_json := v_json || '"customerName":"' || REPLACE(NVL(v_rec.customer_name, ''), '"', '\"') || '",';
        v_json := v_json || '"accountNumber":"' || REPLACE(NVL(v_rec.account_number, ''), '"', '\"') || '",';
        v_json := v_json || '"orderDate":"' || REPLACE(NVL(v_rec.order_date, ''), '"', '\"') || '",';
        v_json := v_json || '"pdfStatus":"' || REPLACE(NVL(v_rec.pdf_status, ''), '"', '\"') || '",';
        v_json := v_json || '"printStatus":"' || REPLACE(NVL(v_rec.print_status, ''), '"', '\"') || '",';
        v_json := v_json || '"pdfPath":"' || REPLACE(NVL(v_rec.pdf_path, ''), '"', '\"') || '",';
        v_json := v_json || '"errorMessage":"' || REPLACE(NVL(v_rec.error_message, ''), '"', '\"') || '"';
        v_json := v_json || '}';
    END LOOP;

    CLOSE c_orders;

    -- Close JSON array
    v_json := v_json || ']}';

    -- Output the complete JSON (single HTP.p call)
    HTP.p(v_json);

    DBMS_OUTPUT.PUT_LINE('Returned orders successfully');

EXCEPTION
    WHEN OTHERS THEN
        HTP.p('{"items":[],"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
