-- ============================================================
-- 62 — DAILY TASKS: run counter
-- ============================================================
-- Track how many times a task was executed (Run with AI or Execute), so the
-- user can see whether — and how often — the prompt has run.
-- Additive. Run once after 57. Safe to re-run.
-- ============================================================
DECLARE
    v_n NUMBER;
BEGIN
    SELECT COUNT(*) INTO v_n FROM user_tab_columns
    WHERE table_name = 'WMS_AI_TASKS' AND column_name = 'RUN_COUNT';
    IF v_n = 0 THEN
        EXECUTE IMMEDIATE 'ALTER TABLE wms_ai_tasks ADD (run_count NUMBER DEFAULT 0)';
    END IF;
END;
/

-- back-fill from existing RESULT events (each run logs one)
UPDATE wms_ai_tasks t
SET run_count = (SELECT COUNT(*) FROM wms_ai_task_events e WHERE e.task_id = t.task_id AND e.kind = 'RESULT')
WHERE NVL(run_count, 0) = 0;
COMMIT;
