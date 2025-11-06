-- ============================================================================
-- POST /trip-order-status - Update PDF Status for Order
-- ============================================================================
-- Updates the pdf_status and pdf_path for a specific order detail
-- Called after PDF download completes to persist status to database
-- ============================================================================

-- Create the procedure
CREATE OR REPLACE PROCEDURE wms_update_order_pdf_status (
    p_detail_id IN NUMBER,
    p_pdf_status IN VARCHAR2,
    p_pdf_path IN VARCHAR2 DEFAULT NULL,
    p_result OUT VARCHAR2
) AS
    v_count NUMBER;
BEGIN
    -- Check if detail exists
    SELECT COUNT(*) INTO v_count
    FROM wms_monitor_printing_details
    WHERE detail_id = p_detail_id;

    IF v_count = 0 THEN
        p_result := 'ERROR: Order detail not found with detail_id=' || p_detail_id;
        RETURN;
    END IF;

    -- Update the order detail
    UPDATE wms_monitor_printing_details
    SET pdf_status = p_pdf_status,
        pdf_path = p_pdf_path,
        last_updated = CURRENT_TIMESTAMP,
        download_attempts = CASE
            WHEN p_pdf_status = 'DOWNLOADED' THEN download_attempts + 1
            ELSE download_attempts
        END
    WHERE detail_id = p_detail_id;

    COMMIT;

    p_result := 'SUCCESS';

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        p_result := 'ERROR: ' || SQLERRM;
END wms_update_order_pdf_status;
/

-- ============================================================================
-- Create REST API endpoint
-- ============================================================================

BEGIN
    -- Delete if exists
    FOR rec IN (SELECT id FROM user_ords_services WHERE name = 'trip-order-status') LOOP
        ORDS.delete_service(p_module_name => 'wms', p_pattern => 'trip-order-status');
    END LOOP;

    -- Create the endpoint
    ORDS.define_service(
        p_module_name => 'wms',
        p_base_path => '/wms/',
        p_items_per_page => 0,
        p_status => 'PUBLISHED',
        p_comments => 'WMS Monitor Printing Order Status Update'
    );

    ORDS.define_template(
        p_module_name => 'wms',
        p_pattern => 'trip-order-status'
    );

    ORDS.define_handler(
        p_module_name => 'wms',
        p_pattern => 'trip-order-status',
        p_method => 'POST',
        p_source_type => ORDS.source_type_plsql,
        p_source => q'[
DECLARE
    v_detail_id NUMBER;
    v_pdf_status VARCHAR2(50);
    v_pdf_path VARCHAR2(500);
    v_result VARCHAR2(4000);
    v_body_clob CLOB;
BEGIN
    -- Read request body
    v_body_clob := :body;

    -- Parse JSON (using APEX_JSON for compatibility)
    APEX_JSON.parse(v_body_clob);

    v_detail_id := APEX_JSON.get_number('detail_id');
    v_pdf_status := APEX_JSON.get_varchar2('pdf_status');
    v_pdf_path := APEX_JSON.get_varchar2('pdf_path');

    -- Call procedure
    wms_update_order_pdf_status(
        p_detail_id => v_detail_id,
        p_pdf_status => v_pdf_status,
        p_pdf_path => v_pdf_path,
        p_result => v_result
    );

    -- Return response
    IF v_result = 'SUCCESS' THEN
        HTP.p('{');
        HTP.p('"status":"success",');
        HTP.p('"message":"Order status updated successfully",');
        HTP.p('"detail_id":' || v_detail_id || ',');
        HTP.p('"pdf_status":"' || v_pdf_status || '"');
        HTP.p('}');
    ELSE
        :status := 400;
        HTP.p('{');
        HTP.p('"status":"error",');
        HTP.p('"message":"' || REPLACE(v_result, '"', '\"') || '"');
        HTP.p('}');
    END IF;

EXCEPTION
    WHEN OTHERS THEN
        :status := 500;
        HTP.p('{');
        HTP.p('"status":"error",');
        HTP.p('"message":"' || REPLACE(SQLERRM, '"', '\"') || '"');
        HTP.p('}');
END;
]',
        p_comments => 'Update PDF status for order detail'
    );

    COMMIT;
END;
/

-- ============================================================================
-- Test the endpoint
-- ============================================================================

-- Test data (assuming detail_id 1 exists)
/*
POST https://your-apex-url/ords/wms/trip-order-status

{
    "detail_id": 1,
    "pdf_status": "DOWNLOADED",
    "pdf_path": "C:\\fusion\\2025-11-05\\1380\\64101.pdf"
}

Expected response:
{
    "status": "success",
    "message": "Order status updated successfully",
    "detail_id": 1,
    "pdf_status": "DOWNLOADED"
}
*/
