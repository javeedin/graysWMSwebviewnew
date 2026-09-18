-- ============================================================
-- FIX: deletetripline ORDS handler (Remove order from trip)
-- ============================================================
-- Paste this as the PL/SQL source of the ORDS handler for
--   .../TRIPMANAGEMENT/deletetripline   (GET, with :P_ORDER_NUMBER, :P_INSTANCE_NAME)
--
-- Why the old one failed:
--   1) SQL%ROWCOUNT was read AFTER the WMS_PICKER_ASSIGNMENT delete, so an
--      order with no picker assignment returned 404 "No record found" even
--      though the trip line WAS deleted -- and the 404 branch never COMMITted,
--      so the delete was silently rolled back at session end.
--   2) If WMS_PICKER_ASSIGNMENT column names differ, that second delete threw
--      ORA-00904 -> WHEN OTHERS -> 500, failing the whole call.
--
-- Fix: base success on the TRIP-LINE delete's rowcount (captured immediately),
-- make the picker cleanup best-effort, and COMMIT/ROLLBACK correctly.
-- ============================================================
DECLARE
    v_deleted   NUMBER := 0;
    v_pickers   NUMBER := 0;
BEGIN
    -- primary delete: the trip line
    DELETE FROM wms_trip_details
    WHERE order_number = :P_ORDER_NUMBER
      AND instance_name = :P_INSTANCE_NAME;
    v_deleted := SQL%ROWCOUNT;                 -- capture NOW, before any other DML

    -- best-effort cleanup: never let this fail the whole operation
    BEGIN
        DELETE FROM wms_picker_assignment
        WHERE source_order_number = :P_ORDER_NUMBER
          AND instance = :P_INSTANCE_NAME;
        v_pickers := SQL%ROWCOUNT;
    EXCEPTION
        WHEN OTHERS THEN
            v_pickers := -1;                   -- table/column mismatch or no row: ignore
    END;

    IF v_deleted = 0 THEN
        ROLLBACK;
        :status_code := 404;
        HTP.P('{"status":"error","message":"No record found for order_number: '
              || :P_ORDER_NUMBER || '"}');
    ELSE
        COMMIT;
        :status_code := 200;
        HTP.P('{"status":"success","message":"Order ' || :P_ORDER_NUMBER
              || ' deleted successfully","tripLines":' || v_deleted
              || ',"pickerRows":' || v_pickers || '}');
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        :status_code := 500;
        HTP.P('{"status":"error","message":"' || REPLACE(SQLERRM, '"', '''') || '"}');
END;
