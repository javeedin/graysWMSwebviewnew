-- ============================================================
-- 57 — AI DIGITAL EMPLOYEE: DAILY TASK BOARD
-- ============================================================
-- Assign day-to-day tasks to the AI Digital Employee, work them, and keep
-- FULL traceability: every task and every action taken on it is stored in
-- the DB. The frontend "Daily Tasks" tab reads/writes these tables through
-- the existing guarded gateways (ai/executequery + ai/executewrite), so NO
-- new ORDS endpoints are required — just run this script once.
--
--   wms_ai_tasks        — the tasks (one row per task, per day for daily ones)
--   wms_ai_task_events  — the timeline: who did what, when (traceability)
--
-- Run once in the WKSP_GRAYSAPP parsing schema.
-- ============================================================

-- ------------------------------------------------------------
-- 1) TASKS
-- ------------------------------------------------------------
DECLARE
    v_exists NUMBER;
BEGIN
    SELECT COUNT(*) INTO v_exists FROM user_tables WHERE table_name = 'WMS_AI_TASKS';
    IF v_exists = 0 THEN
        EXECUTE IMMEDIATE q'[
            CREATE TABLE wms_ai_tasks (
                task_id      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                client_ref   VARCHAR2(40),                          -- client-generated ref (fetch id back after insert)
                title        VARCHAR2(300) NOT NULL,
                description  CLOB,
                assignee     VARCHAR2(120) DEFAULT 'AI Digital Employee',
                category     VARCHAR2(60),
                priority     NUMBER        DEFAULT 2,                -- 1 High, 2 Medium, 3 Low
                task_date    DATE          DEFAULT TRUNC(SYSDATE),   -- the DAY this task is for
                due_at       DATE,
                recurrence   VARCHAR2(10)  DEFAULT 'ONCE',           -- ONCE | DAILY
                status       VARCHAR2(15)  DEFAULT 'OPEN',           -- OPEN, IN_PROGRESS, DONE, BLOCKED, CANCELLED
                result       CLOB,
                issue        CLOB,                                   -- latest problem / blocker note
                instance     VARCHAR2(10)  DEFAULT 'PROD',
                created_by   VARCHAR2(120),
                created_date DATE          DEFAULT SYSDATE,
                started_at   DATE,
                completed_at DATE,
                updated_by   VARCHAR2(120),
                updated_date DATE,
                CONSTRAINT wms_ai_tasks_status_ck CHECK (status IN ('OPEN','IN_PROGRESS','DONE','BLOCKED','CANCELLED')),
                CONSTRAINT wms_ai_tasks_recur_ck  CHECK (recurrence IN ('ONCE','DAILY'))
            )
        ]';
        EXECUTE IMMEDIATE 'CREATE INDEX wms_ai_tasks_date_ix   ON wms_ai_tasks (task_date)';
        EXECUTE IMMEDIATE 'CREATE INDEX wms_ai_tasks_status_ix ON wms_ai_tasks (status)';
        EXECUTE IMMEDIATE 'CREATE INDEX wms_ai_tasks_assign_ix ON wms_ai_tasks (assignee)';
        EXECUTE IMMEDIATE 'CREATE INDEX wms_ai_tasks_ref_ix    ON wms_ai_tasks (client_ref)';
    END IF;
END;
/

-- ------------------------------------------------------------
-- 2) TASK EVENTS (the timeline — full traceability)
-- ------------------------------------------------------------
DECLARE
    v_exists NUMBER;
BEGIN
    SELECT COUNT(*) INTO v_exists FROM user_tables WHERE table_name = 'WMS_AI_TASK_EVENTS';
    IF v_exists = 0 THEN
        EXECUTE IMMEDIATE q'[
            CREATE TABLE wms_ai_task_events (
                event_id   NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                task_id    NUMBER NOT NULL,
                event_time DATE DEFAULT SYSDATE,
                actor      VARCHAR2(20),     -- USER | AI | SYSTEM
                kind       VARCHAR2(20),     -- CREATE, ASSIGN, NOTE, PROGRESS, ISSUE, RESULT, STATUS
                message    CLOB,
                CONSTRAINT wms_ai_task_events_fk FOREIGN KEY (task_id)
                    REFERENCES wms_ai_tasks (task_id) ON DELETE CASCADE
            )
        ]';
        EXECUTE IMMEDIATE 'CREATE INDEX wms_ai_task_events_ix ON wms_ai_task_events (task_id, event_id)';
    END IF;
END;
/

-- ------------------------------------------------------------
-- 3) (optional) seed a couple of example daily tasks
--    Comment out if you do not want sample rows.
-- ------------------------------------------------------------
-- INSERT INTO wms_ai_tasks (title, description, category, priority, recurrence, created_by)
-- VALUES ('Morning trip status sweep', 'Check every open trip for stuck Scheduled/Manual Reservation lines and report.', 'Trips', 1, 'DAILY', 'SETUP');
-- INSERT INTO wms_ai_tasks (title, description, category, priority, recurrence, created_by)
-- VALUES ('Auto-print interfaced orders', 'Print all newly Interfaced orders for today''s trips.', 'Printing', 2, 'DAILY', 'SETUP');
-- COMMIT;

-- ============================================================
-- NOTES
-- ============================================================
-- No ORDS handlers needed: the Daily Tasks tab does all reads via
--   POST ai/executequery  { sql, maxRows, appUser }
-- and all writes via
--   POST ai/executewrite   { sql, appUser }
-- exactly like the Policies and Forms features already do.
--
-- The AI Digital Employee can also append to wms_ai_task_events and update
-- wms_ai_tasks through its normal write path, so when it works a task its
-- progress, issues and result are recorded on the task timeline.
-- ============================================================
