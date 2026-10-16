-- ============================================================================
-- DELETE /rr/endpoints/:id - Delete Endpoint
-- ============================================================================
--
-- This handler deletes an API endpoint configuration record
--
-- APEX REST Configuration:
-- - URI Template: endpoints/:id
-- - Method: DELETE
-- - Source Type: PL/SQL
--
-- URL Parameters:
-- - id: The endpoint_id to delete
--
-- Response:
-- {
--   "status": "SUCCESS",
--   "message": "Endpoint deleted successfully",
--   "data": {
--     "endpoint_id": 123,
--     "rows_deleted": 1
--   }
-- }
-- ============================================================================

DECLARE
    -- URL parameter
    v_endpoint_id NUMBER;

    -- Output variables
    v_rows_deleted NUMBER;
    v_error_msg VARCHAR2(4000);

BEGIN
    -- Get endpoint_id from URL parameter
    BEGIN
        v_endpoint_id := TO_NUMBER(:id);
    EXCEPTION
        WHEN OTHERS THEN
            HTP.p('{"status":"ERROR","message":"Invalid endpoint ID format"}');
            RETURN;
    END;

    IF v_endpoint_id IS NULL THEN
        HTP.p('{"status":"ERROR","message":"endpoint_id is required in URL"}');
        RETURN;
    END IF;

    BEGIN
        -- Delete the endpoint record
        DELETE FROM RR_ENDPOINTS
        WHERE ENDPOINT_ID = v_endpoint_id;

        v_rows_deleted := SQL%ROWCOUNT;

        IF v_rows_deleted = 0 THEN
            ROLLBACK;
            HTP.p('{"status":"ERROR","message":"Endpoint not found with ID: ' || v_endpoint_id || '"}');
            RETURN;
        END IF;

        COMMIT;

        -- Return success response
        HTP.p('{');
        HTP.p('"status":"SUCCESS",');
        HTP.p('"message":"Endpoint deleted successfully",');
        HTP.p('"data":{');
        HTP.p('"endpoint_id":' || v_endpoint_id || ',');
        HTP.p('"rows_deleted":' || v_rows_deleted);
        HTP.p('}');
        HTP.p('}');

    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            v_error_msg := SQLERRM;
            HTP.p('{');
            HTP.p('"status":"ERROR",');
            HTP.p('"message":"Database error: ' || REPLACE(v_error_msg, '"', '\"') || '"');
            HTP.p('}');
    END;

END;
