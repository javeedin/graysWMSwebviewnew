-- GET /monitor-printing/orders?trip_id=XXX
-- Returns order details for a given trip_id

DECLARE
    v_trip_id VARCHAR2(200);
    v_cursor SYS_REFCURSOR;
    v_first_row BOOLEAN := TRUE;

    -- Variables to hold cursor data
    v_detail_id NUMBER;
    v_order_number VARCHAR2(100);
    v_customer_name VARCHAR2(500);
    v_account_number VARCHAR2(100);
    v_order_date VARCHAR2(20);
    v_pdf_status VARCHAR2(50);
    v_print_status VARCHAR2(50);
    v_pdf_path VARCHAR2(1000);
    v_error_message VARCHAR2(4000);
BEGIN
    -- Get trip_id parameter from URL
    v_trip_id := :trip_id;

    -- Validate parameter
    IF v_trip_id IS NULL THEN
        HTP.p('{"items":[],"error":"trip_id parameter is required"}');
        RETURN;
    END IF;

    DBMS_OUTPUT.PUT_LINE('GET orders for trip_id: ' || v_trip_id);

    -- Call the procedure to get order details
    BEGIN
        wms_get_order_details_by_trip(
            p_trip_id => v_trip_id,
            p_cursor => v_cursor
        );
    EXCEPTION WHEN OTHERS THEN
        HTP.p('{"items":[],"error":"Procedure call failed: ' || REPLACE(SQLERRM, '"', '\"') || '"}');
        RETURN;
    END;

    -- Build JSON response
    HTP.p('{"items":[');

    -- Fetch rows from cursor and build JSON array
    BEGIN
        LOOP
            FETCH v_cursor INTO
                v_detail_id,
                v_order_number,
                v_customer_name,
                v_account_number,
                v_order_date,
                v_pdf_status,
                v_print_status,
                v_pdf_path,
                v_error_message;

            EXIT WHEN v_cursor%NOTFOUND;

            -- Add comma between items
            IF NOT v_first_row THEN
                HTP.p(',');
            END IF;
            v_first_row := FALSE;

            -- Build JSON object for this order
            HTP.p('{');
            HTP.p('"detailId":' || NVL(TO_CHAR(v_detail_id), 'null') || ',');
            HTP.p('"orderNumber":"' || REPLACE(NVL(v_order_number, ''), '"', '\"') || '",');
            HTP.p('"customerName":"' || REPLACE(NVL(v_customer_name, ''), '"', '\"') || '",');
            HTP.p('"accountNumber":"' || REPLACE(NVL(v_account_number, ''), '"', '\"') || '",');
            HTP.p('"orderDate":"' || REPLACE(NVL(v_order_date, ''), '"', '\"') || '",');
            HTP.p('"pdfStatus":"' || REPLACE(NVL(v_pdf_status, ''), '"', '\"') || '",');
            HTP.p('"printStatus":"' || REPLACE(NVL(v_print_status, ''), '"', '\"') || '",');
            HTP.p('"pdfPath":"' || REPLACE(NVL(v_pdf_path, ''), '"', '\"') || '",');
            HTP.p('"errorMessage":"' || REPLACE(NVL(v_error_message, ''), '"', '\"') || '"');
            HTP.p('}');

        END LOOP;

        CLOSE v_cursor;

    EXCEPTION WHEN OTHERS THEN
        IF v_cursor%ISOPEN THEN
            CLOSE v_cursor;
        END IF;
        HTP.p('{"items":[],"error":"Error fetching results: ' || REPLACE(SQLERRM, '"', '\"') || '"}');
        RETURN;
    END;

    -- Close JSON array
    HTP.p(']}');

    DBMS_OUTPUT.PUT_LINE('Returned orders successfully');

EXCEPTION
    WHEN OTHERS THEN
        HTP.p('{"items":[],"error":"Unexpected error: ' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
