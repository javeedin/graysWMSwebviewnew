-- ============================================================
-- 58 — DAILY TASKS: make tasks EXECUTABLE
-- ============================================================
-- Adds an executable definition to each task so a task is not just text —
-- it carries the concrete steps (SQL / REST / print / …) to run, plus an
-- optional completion check. The app executes the steps and records the
-- outcome on the task timeline (wms_ai_task_events).
--
--   action_json     CLOB  -> { "steps": [ ... ] }   same step types as a
--                            LOCAL scheduled job (query/rest/print/
--                            download_pdf/forEach/ipc)
--   completion_sql  CLOB  -> optional plain SELECT; 0 rows = the task's
--                            work is fully done
--   last_run_status VARCHAR2(20)  -> SUCCESS / FAILED (last execution)
--   last_run_at     DATE
--
-- Additive. Run once in the WKSP_GRAYSAPP parsing schema.
-- ============================================================
DECLARE
    PROCEDURE add_col(p_col VARCHAR2, p_ddl VARCHAR2) IS
        v_n NUMBER;
    BEGIN
        SELECT COUNT(*) INTO v_n FROM user_tab_columns
        WHERE table_name = 'WMS_AI_TASKS' AND column_name = p_col;
        IF v_n = 0 THEN EXECUTE IMMEDIATE 'ALTER TABLE wms_ai_tasks ADD (' || p_ddl || ')'; END IF;
    END;
BEGIN
    add_col('ACTION_JSON',     'action_json CLOB');
    add_col('COMPLETION_SQL',  'completion_sql CLOB');
    add_col('LAST_RUN_STATUS', 'last_run_status VARCHAR2(20)');
    add_col('LAST_RUN_AT',     'last_run_at DATE');
END;
/

-- No ORDS handlers needed — the Daily Tasks tab reads/writes these columns
-- through ai/executequery and ai/executewrite, same as the rest of the board.
-- ============================================================
