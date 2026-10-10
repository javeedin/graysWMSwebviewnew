-- ============================================================
-- 60 — DAILY TASKS: add TRIP_DATE (the trip day the task works on)
-- ============================================================
-- A task is listed on task_date, but the WORK it does is for a specific
-- TRIP DATE (which may be today, tomorrow, or a date the user picks). The
-- AI must only act on that trip date. This adds trip_date and back-fills
-- existing tasks so trip_date defaults to their task_date.
--
-- Additive. Run once after 57. Safe to re-run.
-- ============================================================
DECLARE
    v_n NUMBER;
BEGIN
    SELECT COUNT(*) INTO v_n FROM user_tab_columns
    WHERE table_name = 'WMS_AI_TASKS' AND column_name = 'TRIP_DATE';
    IF v_n = 0 THEN
        EXECUTE IMMEDIATE 'ALTER TABLE wms_ai_tasks ADD (trip_date DATE)';
    END IF;
END;
/

-- back-fill: default trip_date to the task's own list date where not set
UPDATE wms_ai_tasks SET trip_date = task_date WHERE trip_date IS NULL;
COMMIT;
