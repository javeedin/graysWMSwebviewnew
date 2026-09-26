-- ============================================================
-- 69_fusion_pipelines.sql
-- Fusion SQL › Data Pipelines
--
-- A PIPELINE is one or more TASKS. Each task runs a source SQL
-- (Fusion via the BI Publisher runner, the APEX DB, or a target DB)
-- and pushes the rows to a TARGET connection (Oracle, APEX REST,
-- SQL Server, MySQL, PostgreSQL) with a load mode (append, truncate +
-- insert, merge/upsert, incremental by watermark).
--
-- Pipelines run on a PIPELINE SERVER (Python FastAPI service): it reads
-- these tables, runs the schedules (manual / interval / cron /
-- continuous-until-cancelled), writes run history back here and
-- answers the app (health, public key, test connection, run now,
-- cancel). The app edits definitions and requests runs/cancels.
--
-- Secrets: target passwords are encrypted in the app with the
-- server's RSA public key (RSA-OAEP / SHA-256) and stored as
-- 'rsa-oaep-256:<base64>' in PASSWORD_ENC. Only the pipeline server
-- (private key never leaves it) can decrypt them.
--
-- The Setups tab (Data pipeline setups) creates WMS_PIPE_SERVERS and
-- WMS_PIPE_CONNECTIONS itself; this script creates everything and is
-- safe to re-run (objects are created only when missing).
-- ============================================================

DECLARE
    PROCEDURE ddl(p_name VARCHAR2, p_sql VARCHAR2) IS
        n NUMBER;
    BEGIN
        SELECT COUNT(*) INTO n FROM user_objects WHERE object_name = p_name;
        IF n = 0 THEN EXECUTE IMMEDIATE p_sql; END IF;
    END;
BEGIN
    -- ── Pipeline servers (FastAPI) ─────────────────────────────
    ddl('WMS_PIPE_SERVERS', q'[CREATE TABLE wms_pipe_servers (
        server_id       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        server_name     VARCHAR2(100) NOT NULL,
        protocol        VARCHAR2(5)   DEFAULT 'http' NOT NULL,     -- http | https
        host            VARCHAR2(255) NOT NULL,                    -- IP or DNS name, e.g. 145.241.119.134
        port            NUMBER(5)     DEFAULT 8000 NOT NULL,
        base_path       VARCHAR2(200) DEFAULT '/',                 -- e.g. /pipeline
        api_user        VARCHAR2(100),                             -- HTTP Basic user the app sends
        api_token       VARCHAR2(400),                             -- HTTP Basic password / API token
        public_key      VARCHAR2(4000),                            -- server RSA public key (PEM), fetched by Test
        key_fingerprint VARCHAR2(100),                             -- SHA-256 of the key, shown in the app
        timezone        VARCHAR2(60)  DEFAULT 'UTC',               -- schedules are evaluated in this zone
        poll_seconds    NUMBER        DEFAULT 30,                  -- how often the server re-reads definitions
        max_parallel    NUMBER        DEFAULT 4,                   -- pipelines running at the same time
        is_default      VARCHAR2(1)   DEFAULT 'N' CHECK (is_default IN ('Y','N')),
        active          VARCHAR2(1)   DEFAULT 'Y' CHECK (active IN ('Y','N')),
        status          VARCHAR2(20),                              -- ONLINE | OFFLINE | ERROR (last test / heartbeat)
        server_version  VARCHAR2(60),
        last_heartbeat  TIMESTAMP,                                 -- written by the server
        last_test_date  DATE,
        last_test_msg   VARCHAR2(4000),
        notes           VARCHAR2(2000),
        created_by      VARCHAR2(120),
        created_date    DATE DEFAULT SYSDATE,
        updated_by      VARCHAR2(120),
        updated_date    DATE)]');
    ddl('WMS_PIPE_SERVERS_NAME_UX', 'CREATE UNIQUE INDEX wms_pipe_servers_name_ux ON wms_pipe_servers (UPPER(server_name))');

    -- ── Connections (targets, and databases usable as a source) ─
    ddl('WMS_PIPE_CONNECTIONS', q'[CREATE TABLE wms_pipe_connections (
        conn_id         NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        conn_name       VARCHAR2(100) NOT NULL,
        conn_type       VARCHAR2(20)  NOT NULL,   -- ORACLE_EZ | ORACLE_TNS | ORACLE_WALLET | APEX_REST | MSSQL | MYSQL | POSTGRES
        server_id       NUMBER,                   -- pipeline server that uses it (its key encrypts the password)
        host            VARCHAR2(255),
        port            NUMBER(5),
        service_name    VARCHAR2(200),            -- Oracle service / ADB service (e.g. xyz_high)
        database_name   VARCHAR2(200),            -- SQL Server / MySQL / PostgreSQL database
        tns_alias       VARCHAR2(200),
        tns_descriptor  VARCHAR2(4000),           -- full (DESCRIPTION=…) when no tnsnames.ora on the server
        wallet_path     VARCHAR2(500),            -- ADB wallet folder on the pipeline server
        rest_url        VARCHAR2(1000),           -- APEX / ORDS base URL
        auth_type       VARCHAR2(20),             -- NONE | BASIC | BEARER (REST) ; PASSWORD (databases)
        username        VARCHAR2(200),
        password_enc    VARCHAR2(4000),           -- 'rsa-oaep-256:<base64>' — only the pipeline server can decrypt
        default_schema  VARCHAR2(128),
        options_json    VARCHAR2(4000),           -- driver options: {"encrypt":true,"sslmode":"require",…}
        active          VARCHAR2(1) DEFAULT 'Y' CHECK (active IN ('Y','N')),
        last_test_status VARCHAR2(20),            -- OK | ERROR
        last_test_date  DATE,
        last_test_msg   VARCHAR2(4000),
        notes           VARCHAR2(2000),
        created_by      VARCHAR2(120),
        created_date    DATE DEFAULT SYSDATE,
        updated_by      VARCHAR2(120),
        updated_date    DATE,
        CONSTRAINT wms_pipe_conn_type_ck CHECK (conn_type IN ('ORACLE_EZ','ORACLE_TNS','ORACLE_WALLET','APEX_REST','MSSQL','MYSQL','POSTGRES')))]');
    ddl('WMS_PIPE_CONNECTIONS_NAME_UX', 'CREATE UNIQUE INDEX wms_pipe_connections_name_ux ON wms_pipe_connections (UPPER(conn_name))');

    -- ── Pipelines ───────────────────────────────────────────────
    ddl('WMS_PIPELINES', q'[CREATE TABLE wms_pipelines (
        pipeline_id     NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        pipeline_name   VARCHAR2(200) NOT NULL,
        description     VARCHAR2(2000),
        server_id       NUMBER,                   -- which pipeline server runs it (NULL = default)
        schedule_type   VARCHAR2(20) DEFAULT 'MANUAL' NOT NULL,  -- MANUAL | INTERVAL | CRON | CONTINUOUS
        interval_seconds NUMBER,                  -- INTERVAL: every n seconds; CONTINUOUS: pause between cycles
        cron_expr       VARCHAR2(100),            -- CRON: 5-field cron, e.g. '0 */2 * * *'
        timezone        VARCHAR2(60),             -- NULL = server timezone
        start_date      DATE,
        end_date        DATE,
        enabled         VARCHAR2(1) DEFAULT 'N' CHECK (enabled IN ('Y','N')),   -- schedule on/off
        params_json     VARCHAR2(4000),           -- default parameter values for the task SQL
        on_error        VARCHAR2(10) DEFAULT 'STOP',   -- STOP | CONTINUE (next task)
        notify_email    VARCHAR2(400),
        state           VARCHAR2(20) DEFAULT 'IDLE',   -- IDLE | QUEUED | RUNNING | CANCEL_REQUESTED  (server-maintained)
        next_run_date   TIMESTAMP,                -- computed by the server
        last_run_id     NUMBER,
        last_run_status VARCHAR2(20),
        last_run_date   TIMESTAMP,
        created_by      VARCHAR2(120),
        created_date    DATE DEFAULT SYSDATE,
        updated_by      VARCHAR2(120),
        updated_date    DATE,
        CONSTRAINT wms_pipelines_sched_ck CHECK (schedule_type IN ('MANUAL','INTERVAL','CRON','CONTINUOUS')))]');
    ddl('WMS_PIPELINES_NAME_UX', 'CREATE UNIQUE INDEX wms_pipelines_name_ux ON wms_pipelines (UPPER(pipeline_name))');

    -- ── Tasks (one SQL → one target) ────────────────────────────
    ddl('WMS_PIPE_TASKS', q'[CREATE TABLE wms_pipe_tasks (
        task_id         NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        pipeline_id     NUMBER NOT NULL,
        seq             NUMBER NOT NULL,          -- run order inside the pipeline
        task_name       VARCHAR2(200) NOT NULL,
        source_type     VARCHAR2(20) DEFAULT 'FUSION' NOT NULL,   -- FUSION (BIP runner) | APEX | CONNECTION
        source_conn_id  NUMBER,                   -- when source_type = CONNECTION
        source_sql      CLOB NOT NULL,            -- may use {{P_…}} parameters and {{WATERMARK}}
        target_conn_id  NUMBER NOT NULL,
        target_object   VARCHAR2(400) NOT NULL,   -- table name, or REST endpoint path for APEX_REST
        load_mode       VARCHAR2(20) DEFAULT 'APPEND' NOT NULL,   -- APPEND | TRUNCATE_INSERT | MERGE | INCREMENTAL
        key_columns     VARCHAR2(1000),           -- MERGE / upsert keys, comma separated
        column_map_json VARCHAR2(4000),           -- {"SOURCE_COL":"TARGET_COL",…}; empty = same names
        create_target   VARCHAR2(1) DEFAULT 'Y' CHECK (create_target IN ('Y','N')),  -- create table if missing
        watermark_column VARCHAR2(128),           -- INCREMENTAL: e.g. LAST_UPDATE_DATE
        last_watermark  VARCHAR2(100),            -- maintained by the server after each successful run
        batch_size      NUMBER DEFAULT 5000,
        row_limit       NUMBER,                   -- optional cap per run
        timeout_seconds NUMBER DEFAULT 900,
        depends_on      VARCHAR2(400),            -- task ids that must succeed first (comma separated)
        active          VARCHAR2(1) DEFAULT 'Y' CHECK (active IN ('Y','N')),
        created_by      VARCHAR2(120),
        created_date    DATE DEFAULT SYSDATE,
        updated_by      VARCHAR2(120),
        updated_date    DATE,
        CONSTRAINT wms_pipe_tasks_src_ck  CHECK (source_type IN ('FUSION','APEX','CONNECTION')),
        CONSTRAINT wms_pipe_tasks_mode_ck CHECK (load_mode IN ('APPEND','TRUNCATE_INSERT','MERGE','INCREMENTAL')))]');
    ddl('WMS_PIPE_TASKS_PX', 'CREATE INDEX wms_pipe_tasks_px ON wms_pipe_tasks (pipeline_id, seq)');

    -- ── Run history ─────────────────────────────────────────────
    ddl('WMS_PIPE_RUNS', q'[CREATE TABLE wms_pipe_runs (
        run_id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        pipeline_id     NUMBER NOT NULL,
        server_id       NUMBER,
        trigger_type    VARCHAR2(20),             -- SCHEDULE | MANUAL | CONTINUOUS
        requested_by    VARCHAR2(120),
        requested_date  TIMESTAMP DEFAULT SYSTIMESTAMP,
        status          VARCHAR2(20) DEFAULT 'QUEUED',   -- QUEUED | RUNNING | SUCCESS | FAILED | CANCELLED
        cancel_requested VARCHAR2(1) DEFAULT 'N' CHECK (cancel_requested IN ('Y','N')),  -- the app sets Y, the server stops
        cycle_no        NUMBER DEFAULT 1,         -- CONTINUOUS: cycles completed so far
        params_json     VARCHAR2(4000),
        started_date    TIMESTAMP,
        ended_date      TIMESTAMP,
        rows_read       NUMBER DEFAULT 0,
        rows_written    NUMBER DEFAULT 0,
        error_text      VARCHAR2(4000))]');
    ddl('WMS_PIPE_RUNS_PX', 'CREATE INDEX wms_pipe_runs_px ON wms_pipe_runs (pipeline_id, requested_date)');
    ddl('WMS_PIPE_RUNS_SX', 'CREATE INDEX wms_pipe_runs_sx ON wms_pipe_runs (status)');

    ddl('WMS_PIPE_TASK_RUNS', q'[CREATE TABLE wms_pipe_task_runs (
        task_run_id     NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        run_id          NUMBER NOT NULL,
        task_id         NUMBER NOT NULL,
        cycle_no        NUMBER DEFAULT 1,
        status          VARCHAR2(20),             -- RUNNING | SUCCESS | FAILED | SKIPPED | CANCELLED
        started_date    TIMESTAMP,
        ended_date      TIMESTAMP,
        rows_read       NUMBER,
        rows_written    NUMBER,
        watermark_from  VARCHAR2(100),
        watermark_to    VARCHAR2(100),
        error_text      VARCHAR2(4000))]');
    ddl('WMS_PIPE_TASK_RUNS_RX', 'CREATE INDEX wms_pipe_task_runs_rx ON wms_pipe_task_runs (run_id)');

    ddl('WMS_PIPE_LOG', q'[CREATE TABLE wms_pipe_log (
        log_id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        run_id          NUMBER,
        task_run_id     NUMBER,
        log_time        TIMESTAMP DEFAULT SYSTIMESTAMP,
        log_level       VARCHAR2(10),             -- INFO | WARN | ERROR
        message         VARCHAR2(4000))]');
    ddl('WMS_PIPE_LOG_RX', 'CREATE INDEX wms_pipe_log_rx ON wms_pipe_log (run_id, log_id)');
END;
/

-- ── Status view for the app (latest run per pipeline) ──────────
CREATE OR REPLACE VIEW wms_pipe_status_v AS
SELECT p.pipeline_id, p.pipeline_name, p.schedule_type, p.enabled, p.state, p.next_run_date,
       r.run_id, r.status AS run_status, r.trigger_type, r.cycle_no, r.started_date, r.ended_date,
       r.rows_read, r.rows_written, r.error_text,
       (SELECT COUNT(*) FROM wms_pipe_tasks t WHERE t.pipeline_id = p.pipeline_id AND t.active = 'Y') AS task_count
FROM   wms_pipelines p
LEFT JOIN (SELECT x.*,
                  ROW_NUMBER() OVER (PARTITION BY x.pipeline_id ORDER BY x.run_id DESC) AS rn
           FROM   wms_pipe_runs x) r
       ON r.pipeline_id = p.pipeline_id AND r.rn = 1;

-- Check
SELECT object_name, object_type FROM user_objects
WHERE  object_name LIKE 'WMS\_PIPE%' ESCAPE '\' ORDER BY object_type, object_name;
