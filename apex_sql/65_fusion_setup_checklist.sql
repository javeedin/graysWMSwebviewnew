-- ============================================================
-- 65 — FUSION SQL: SETUP CHECKLIST (module-wise setup tasks + check SQL)
-- ============================================================
-- The "Fusion Setups" tab of the Fusion SQL workbench (fusionsql/index.html)
-- lists Oracle Fusion setup tasks by module. Each task has a CHECK SQL that
-- is run on the Fusion pod through the same BI Publisher runner as the SQL
-- Builder: the task is DONE when the SQL returns at least MIN_ROWS rows, and
-- the same SQL is used to drill down into the configured records.
--
--   wms_fusion_setup_tasks    — the checklist: module, task, check SQL
--   wms_fusion_setup_results  — last check result per task and pod (PROD/TEST)
--
-- The page creates both tables itself (via ai/executewrite) and loads a
-- starter checklist (fusionsql/setups-seed.js) on first use, so running this
-- script is optional.
--
-- Run once in the WKSP_GRAYSAPP parsing schema.
-- ============================================================

DECLARE
    v_exists NUMBER;
BEGIN
    SELECT COUNT(*) INTO v_exists FROM user_tables WHERE table_name = 'WMS_FUSION_SETUP_TASKS';
    IF v_exists = 0 THEN
        EXECUTE IMMEDIATE q'[
            CREATE TABLE wms_fusion_setup_tasks (
                task_id       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                task_code     VARCHAR2(60)   NOT NULL,          -- stable key, e.g. GL_LEDGERS
                module_code   VARCHAR2(20)   NOT NULL,          -- GL, AP, AR, INV, OM …
                module_name   VARCHAR2(100),
                seq           NUMBER         DEFAULT 100,       -- order inside the module
                task_name     VARCHAR2(300)  NOT NULL,
                description   VARCHAR2(2000),
                fsm_task      VARCHAR2(300),                    -- Setup and Maintenance task name
                check_sql     CLOB           NOT NULL,          -- returns the configured records
                min_rows      NUMBER         DEFAULT 1,         -- DONE when row count >= min_rows
                mandatory     VARCHAR2(1)    DEFAULT 'Y',
                active        VARCHAR2(1)    DEFAULT 'Y',
                source        VARCHAR2(10)   DEFAULT 'USER',    -- STARTER | USER
                created_by    VARCHAR2(120),
                created_date  DATE           DEFAULT SYSDATE,
                updated_by    VARCHAR2(120),
                updated_date  DATE
            )
        ]';
        EXECUTE IMMEDIATE 'CREATE UNIQUE INDEX wms_fusion_setup_tasks_code_ux ON wms_fusion_setup_tasks (task_code)';
    END IF;

    SELECT COUNT(*) INTO v_exists FROM user_tables WHERE table_name = 'WMS_FUSION_SETUP_RESULTS';
    IF v_exists = 0 THEN
        EXECUTE IMMEDIATE q'[
            CREATE TABLE wms_fusion_setup_results (
                task_id       NUMBER        NOT NULL,
                instance      VARCHAR2(10)  NOT NULL,           -- PROD | TEST
                status        VARCHAR2(10),                     -- DONE | MISSING | ERROR
                row_count     NUMBER,
                checked_date  DATE,
                checked_by    VARCHAR2(120),
                elapsed_ms    NUMBER,
                error_text    VARCHAR2(4000),
                CONSTRAINT wms_fusion_setup_results_pk PRIMARY KEY (task_id, instance)
            )
        ]';
    END IF;
END;
/

-- ------------------------------------------------------------
-- Checks
-- ------------------------------------------------------------
-- SELECT t.module_code, t.task_name, r.instance, r.status, r.row_count, r.checked_date
-- FROM   wms_fusion_setup_tasks t
-- LEFT   JOIN wms_fusion_setup_results r ON r.task_id = t.task_id
-- ORDER  BY t.module_code, t.seq;
