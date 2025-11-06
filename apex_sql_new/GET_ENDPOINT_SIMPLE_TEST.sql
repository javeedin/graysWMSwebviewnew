-- GET /monitor-printing/orders?trip_id=XXX
-- SIMPLE TEST VERSION: Just queries the table directly (no procedure)

DECLARE
    v_trip_id VARCHAR2(200);
    v_count NUMBER;
BEGIN
    -- Get trip_id parameter
    v_trip_id := :trip_id;

    -- Validate parameter
    IF v_trip_id IS NULL THEN
        HTP.p('{"error":"trip_id parameter is required"}');
        RETURN;
    END IF;

    -- Check if trip_id exists
    SELECT COUNT(*)
    INTO v_count
    FROM wms_monitor_printing_details
    WHERE trip_id = v_trip_id;

    -- Return simple test response
    HTP.p('{');
    HTP.p('"success":true,');
    HTP.p('"message":"GET endpoint is working",');
    HTP.p('"tripId":"' || v_trip_id || '",');
    HTP.p('"ordersFound":' || v_count);
    HTP.p('}');

EXCEPTION
    WHEN OTHERS THEN
        HTP.p('{"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
