-- GET /monitor-printing/orders?trip_id=XXX
-- HARDCODED TEST: Returns fake data to isolate the issue

DECLARE
    v_trip_id VARCHAR2(200);
BEGIN
    -- Get trip_id parameter
    v_trip_id := :trip_id;

    -- Validate parameter
    IF v_trip_id IS NULL THEN
        HTP.p('{"items":[],"error":"trip_id parameter is required"}');
        RETURN;
    END IF;

    -- Return hardcoded JSON response
    HTP.p('{"items":[{"detailId":1,"orderNumber":"ORD001","customerName":"Test Customer","accountNumber":"ACC001","orderDate":"2025-11-06","pdfStatus":"PENDING","printStatus":"PENDING","pdfPath":"","errorMessage":""},{"detailId":2,"orderNumber":"ORD002","customerName":"Another Customer","accountNumber":"ACC002","orderDate":"2025-11-06","pdfStatus":"PENDING","printStatus":"PENDING","pdfPath":"","errorMessage":""}]}');

EXCEPTION
    WHEN OTHERS THEN
        HTP.p('{"items":[],"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
