-- ================================================================
-- 71_fsm_tracking.sql — Data Loading › Setup Projects (Oracle FSM)
-- ================================================================
-- Tracks Functional Setup Manager implementation projects and their
-- tasks. The page reads FSM (ASM_ objects, e.g. ASM_IMPL_PROJECTS_VL)
-- read-only through the Fusion SQL BIP runner and keeps the history here:
--   WMS_FSM_CONFIG       per pod: which Fusion objects/columns hold projects and tasks
--   WMS_FSM_TASKS        current state of every task seen (first seen, completed seen)
--   WMS_FSM_TASK_EVENTS  every status change detected between two refreshes
--   WMS_FSM_SNAPSHOTS    per project and refresh: totals by status (burn-down)
-- The page creates these tables itself on first use through
-- ai/executewrite; this script is the same DDL for running by hand.
-- ================================================================

CREATE TABLE wms_fsm_config (
    instance        VARCHAR2(10)  PRIMARY KEY,               -- PROD / TEST
    config_json     CLOB,
    updated_by      VARCHAR2(120),
    updated_date    DATE DEFAULT SYSDATE
);

CREATE TABLE wms_fsm_tasks (
    instance        VARCHAR2(10)   NOT NULL,
    project_key     VARCHAR2(100)  NOT NULL,
    task_key        VARCHAR2(200)  NOT NULL,
    project_name    VARCHAR2(400),
    task_name       VARCHAR2(1000),
    task_list       VARCHAR2(1000),
    status          VARCHAR2(60),                             -- normalised: Not Started / In Progress / Completed / Completed with errors
    status_raw      VARCHAR2(100),                            -- as stored in Fusion
    assignee        VARCHAR2(400),
    due_date        VARCHAR2(30),
    fusion_updated  VARCHAR2(30),
    first_seen      DATE,
    last_seen       DATE,
    completed_seen  DATE,                                     -- first refresh that saw it completed
    CONSTRAINT wms_fsm_tasks_pk PRIMARY KEY (instance, project_key, task_key)
);

CREATE TABLE wms_fsm_task_events (
    event_id        NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    instance        VARCHAR2(10),
    project_key     VARCHAR2(100),
    task_key        VARCHAR2(200),
    task_name       VARCHAR2(1000),
    old_status      VARCHAR2(60),
    new_status      VARCHAR2(60),
    event_date      DATE DEFAULT SYSDATE,
    detected_by     VARCHAR2(120)
);

CREATE TABLE wms_fsm_snapshots (
    snap_id         NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    instance        VARCHAR2(10),
    project_key     VARCHAR2(100),
    project_name    VARCHAR2(400),
    total           NUMBER,
    completed       NUMBER,
    in_progress     NUMBER,
    not_started     NUMBER,
    with_errors     NUMBER,
    overdue         NUMBER,
    taken_by        VARCHAR2(120),
    taken_date      DATE DEFAULT SYSDATE
);

CREATE INDEX wms_fsm_task_events_n1 ON wms_fsm_task_events (instance, project_key, event_date);
CREATE INDEX wms_fsm_snapshots_n1   ON wms_fsm_snapshots (instance, project_key, snap_id);

-- Check
SELECT table_name FROM user_tables WHERE table_name LIKE 'WMS\_FSM%' ESCAPE '\' ORDER BY table_name;

-- ── Setup data exports (FSM CSV file packages) ────────────────────
-- Each export of an offering / functional area / task (or an uploaded ZIP)
-- and, per business-object CSV inside it, how many rows it holds — so you
-- see what setup exists, what is empty, and how two exports differ.
CREATE TABLE wms_fsm_exports (
    export_id        NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    instance         VARCHAR2(10),
    scope            VARCHAR2(20),                    -- OFFERING / AREA / TASK / UPLOAD
    offering_code    VARCHAR2(200),
    area_code        VARCHAR2(200),
    task_code        VARCHAR2(200),
    process_id       VARCHAR2(40),
    status           VARCHAR2(20),                    -- RUNNING / ANALYSED / FAILED
    file_name        VARCHAR2(300),
    file_path        VARCHAR2(500),                   -- C:\fusion\FSM\{POD}\… on the PC that downloaded it
    file_bytes       NUMBER,
    objects          NUMBER,
    objects_with_data NUMBER,
    total_rows       NUMBER,
    note             VARCHAR2(1000),
    requested_by     VARCHAR2(120),
    requested_date   DATE DEFAULT SYSDATE,
    completed_date   DATE
);

CREATE TABLE wms_fsm_export_objects (
    export_id        NUMBER        NOT NULL,
    csv_name         VARCHAR2(200) NOT NULL,
    object_name      VARCHAR2(300),
    description      VARCHAR2(1000),
    area             VARCHAR2(60),
    row_count        NUMBER,
    col_count        NUMBER,
    header           VARCHAR2(4000),
    CONSTRAINT wms_fsm_export_objects_pk PRIMARY KEY (export_id, csv_name)
);
