-- GET /monitor-printing/orders?trip_id=XXX
-- Version: Using JSON_ARRAYAGG (cleaner, more modern)

DECLARE
    v_trip_id VARCHAR2(200);
    v_json_result CLOB;
BEGIN
    -- Get trip_id parameter from URL
    v_trip_id := :trip_id;

    -- Validate parameter
    IF v_trip_id IS NULL THEN
        HTP.p('{"items":[],"error":"trip_id parameter is required"}');
        RETURN;
    END IF;

    DBMS_OUTPUT.PUT_LINE('GET orders for trip_id: ' || v_trip_id);

    -- Query data and build JSON using native Oracle JSON functions
    BEGIN
        SELECT JSON_OBJECT(
            'items' VALUE JSON_ARRAYAGG(
                JSON_OBJECT(
                    'detailId' VALUE detail_id,
                    'orderNumber' VALUE order_number,
                    'customerName' VALUE customer_name,
                    'accountNumber' VALUE account_number,
                    'orderDate' VALUE order_date,
                    'pdfStatus' VALUE pdf_status,
                    'printStatus' VALUE print_status,
                    'pdfPath' VALUE pdf_path,
                    'errorMessage' VALUE error_message
                    ABSENT ON NULL
                )
                ORDER BY order_number
            )
        )
        INTO v_json_result
        FROM wms_monitor_printing_details
        WHERE trip_id = v_trip_id;

        -- Output the JSON
        HTP.p(v_json_result);

        DBMS_OUTPUT.PUT_LINE('Returned orders successfully');

    EXCEPTION WHEN NO_DATA_FOUND THEN
        -- No orders found, return empty array
        HTP.p('{"items":[]}');
    WHEN OTHERS THEN
        HTP.p('{"items":[],"error":"Query failed: ' || REPLACE(SQLERRM, '"', '\"') || '"}');
    END;

EXCEPTION
    WHEN OTHERS THEN
        HTP.p('{"items":[],"error":"Unexpected error: ' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
