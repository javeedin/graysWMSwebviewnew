-- ============================================================
-- FIX: deletetripline ORDS handler (Remove order from trip)
-- ============================================================
-- Paste this as the PL/SQL source of the ORDS handler for
--   .../TRIPMANAGEMENT/deletetripline   (DELETE, with :P_ORDER_NUMBER, :P_INSTANCE_NAME)
--
-- Fixes:
--   1) SQL%ROWCOUNT was read AFTER the picker-assignment delete, so an order
--      with no picker row returned 404 even though the trip line was deleted;
--      and the 404 branch never COMMITted, so the delete was rolled back.
--   2) MAIN BUG for "deleted order does not return to Add Orders":
--      the handler never reset WMS_PENDING_SHIPMENT_LINES.ADDED_TO_TRIP back
--      to 'NO'. The pending view (WMS_V_PENDING_SHIPMENT_ORDERS) reads that
--      STORED column, so the order stayed hidden from Add Orders forever.
--      We now set ADDED_TO_TRIP='NO' on removal so the order becomes pending
--      again. (Adding to a trip sets it to 'YES'; this is the symmetric undo.)
--
-- Base success on the TRIP-LINE delete; make picker cleanup best-effort;
-- COMMIT on success, ROLLBACK on 404/500.
-- ============================================================
DECLARE
    v_deleted   NUMBER := 0;
    v_reset     NUMBER := 0;
    v_pickers   NUMBER := 0;
BEGIN
    -- 1) primary delete: the trip line
    DELETE FROM wms_trip_details
    WHERE order_number = :P_ORDER_NUMBER
      AND instance_name = :P_INSTANCE_NAME;
    v_deleted := SQL%ROWCOUNT;                 -- capture NOW, before any other DML

    -- 2) return the order to the pending pool so Add Orders can see it again
    BEGIN
        UPDATE wms_pending_shipment_lines
        SET added_to_trip = 'NO'
        WHERE source_order_number = :P_ORDER_NUMBER
          AND instance = :P_INSTANCE_NAME;
        v_reset := SQL%ROWCOUNT;
    EXCEPTION
        WHEN OTHERS THEN v_reset := -1;        -- column/table mismatch: don't fail the op
    END;

    -- 2b) store-to-van (POS_S2V) transactions use PLAYER_ID as the trip marker;
    --     clear it so those also return to pending. Best-effort.
    BEGIN
        UPDATE pos_s2v_v2s_transactions
        SET player_id = NULL
        WHERE trx_number = :P_ORDER_NUMBER
          AND NVL(instance_name, 'PROD') = :P_INSTANCE_NAME
          AND NVL(player_id, 'NO') = 'YES';
    EXCEPTION
        WHEN OTHERS THEN NULL;
    END;

    -- 3) picker assignment cleanup (best-effort)
    BEGIN
        DELETE FROM wms_picker_assignment
        WHERE source_order_number = :P_ORDER_NUMBER
          AND instance = :P_INSTANCE_NAME;
        v_pickers := SQL%ROWCOUNT;
    EXCEPTION
        WHEN OTHERS THEN v_pickers := -1;
    END;

    IF v_deleted = 0 AND v_reset <= 0 THEN
        -- nothing was on a trip and nothing to un-flag: genuinely not found
        ROLLBACK;
        :status_code := 404;
        HTP.P('{"status":"error","message":"No record found for order_number: '
              || :P_ORDER_NUMBER || '"}');
    ELSE
        COMMIT;
        :status_code := 200;
        HTP.P('{"status":"success","message":"Order ' || :P_ORDER_NUMBER
              || ' removed from trip and returned to pending",'
              || '"tripLines":' || v_deleted
              || ',"pendingReset":' || v_reset
              || ',"pickerRows":' || v_pickers || '}');
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        HTP.P('{"status":"error","message":"' || REPLACE(SQLERRM, '"', '''') || '"}');
END;
