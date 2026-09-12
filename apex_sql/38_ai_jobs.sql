-- ============================================================
-- WMS AI CHAT - SCHEDULED JOBS (DBMS_SCHEDULER)
-- ============================================================
-- Jobs are created from the AI chat (after user approval), run
-- inside the database via DBMS_SCHEDULER, execute a plan of REST
-- and SQL steps, and can repeat until a completion condition is
-- met. Monitored from the "Scheduled Jobs" tab in the app.
--
-- Run order (SQL Workshop, one statement at a time):
--   1. wms_ai_settings  (+ seed rows - THEN UPDATE THE VALUES)
--   2. wms_ai_jobs
--   3. wms_ai_job_runs
--   4. wms_ai_job_runner    (procedure)
--   5. wms_ai_job_create    (procedure)
--   6. wms_ai_job_cancel    (procedure)
--   7. wms_ai_job_runnow    (procedure)
-- Then create the REST handlers listed at the bottom.
--
-- Prerequisites:
--   - 35_ai_chat_tables.sql (wms_ai_log_query) and 36 (wms_ai_execute_sql)
--   - APEX_WEB_SERVICE outbound access to the ORDS + Fusion hosts
--     (test: SELECT APEX_WEB_SERVICE.MAKE_REST_REQUEST('https://efmh-test.fa.em3.oraclecloud.com','GET') FROM dual;
--      ORA-24247 means a network ACL grant is required)
-- ============================================================


-- ============================================================
-- 1. SETTINGS (key/value) - Fusion credentials for job runs
-- ============================================================
CREATE TABLE wms_ai_settings (
    setting_key   VARCHAR2(100) PRIMARY KEY,
    setting_value VARCHAR2(1000),
    description   VARCHAR2(500),
    updated_date  DATE DEFAULT SYSDATE
);

COMMENT ON TABLE wms_ai_settings IS 'Settings for AI features that must be available inside the database (e.g. Fusion credentials for scheduled job REST calls).';

INSERT INTO wms_ai_settings (setting_key, setting_value, description)
VALUES ('FUSION_USERNAME', 'CHANGE_ME', 'Oracle Fusion user for scheduled job REST calls');
INSERT INTO wms_ai_settings (setting_key, setting_value, description)
VALUES ('FUSION_PASSWORD', 'CHANGE_ME', 'Oracle Fusion password for scheduled job REST calls');
INSERT INTO wms_ai_settings (setting_key, setting_value, description)
VALUES ('FUSION_INSTANCE', 'PROD', 'Default Fusion instance for scheduled jobs: PROD or TEST. Used when a job does not specify one, and resolves the #FUSION_BASE# placeholder in step URLs.');
INSERT INTO wms_ai_settings (setting_key, setting_value, description)
VALUES ('FUSION_USERNAME_TEST', NULL, 'Optional: Fusion user for the TEST instance. Leave NULL to reuse FUSION_USERNAME on TEST too.');
INSERT INTO wms_ai_settings (setting_key, setting_value, description)
VALUES ('FUSION_PASSWORD_TEST', NULL, 'Optional: Fusion password for the TEST instance. Leave NULL to reuse FUSION_PASSWORD on TEST too.');
COMMIT;
-- !! UPDATE the rows above with the real values:
-- FUSION_USERNAME / FUSION_PASSWORD are used for PROD jobs, and for TEST
-- jobs too UNLESS both _TEST rows are filled in:
-- UPDATE wms_ai_settings SET setting_value='...'  WHERE setting_key='FUSION_USERNAME';
-- UPDATE wms_ai_settings SET setting_value='...'  WHERE setting_key='FUSION_PASSWORD';
-- UPDATE wms_ai_settings SET setting_value='...'  WHERE setting_key='FUSION_USERNAME_TEST';  -- only if TEST creds differ
-- UPDATE wms_ai_settings SET setting_value='...'  WHERE setting_key='FUSION_PASSWORD_TEST';  -- only if TEST creds differ
-- UPDATE wms_ai_settings SET setting_value='TEST' WHERE setting_key='FUSION_INSTANCE';       -- optional default instance
-- COMMIT;


-- ============================================================
-- 2. JOBS
-- ============================================================
CREATE TABLE wms_ai_jobs (
    job_id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_name          VARCHAR2(200) NOT NULL,
    description       VARCHAR2(1000),
    steps_json        CLOB NOT NULL,             -- {"steps":[ ... ]}
    schedule_type     VARCHAR2(20) DEFAULT 'ONCE'
                      CHECK (schedule_type IN ('ONCE','RECURRING','REPEAT_UNTIL_DONE')),
    start_at          DATE DEFAULT SYSDATE,
    interval_minutes  NUMBER,
    completion_sql    CLOB,                      -- SELECT returning one number; 0 = done
    max_runs          NUMBER DEFAULT 50,
    until_date        DATE,
    status            VARCHAR2(20) DEFAULT 'SCHEDULED'
                      CHECK (status IN ('SCHEDULED','RUNNING','COMPLETED','FAILED','CANCELLED','EXPIRED')),
    instance          VARCHAR2(10) DEFAULT 'PROD',
    created_by        VARCHAR2(100),
    created_machine   VARCHAR2(100),
    created_date      DATE DEFAULT SYSDATE,
    runs_count        NUMBER DEFAULT 0,
    last_run_at       DATE,
    last_error        VARCHAR2(4000)
);

COMMENT ON TABLE wms_ai_jobs IS 'AI-scheduled background jobs. Each row owns DBMS_SCHEDULER job AI_JOB_<job_id> which calls WMS_AI_JOB_RUNNER.';


-- ============================================================
-- 3. JOB RUNS
-- ============================================================
CREATE TABLE wms_ai_job_runs (
    run_id       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id       NUMBER NOT NULL REFERENCES wms_ai_jobs(job_id) ON DELETE CASCADE,
    started_at   DATE DEFAULT SYSDATE,
    finished_at  DATE,
    status       VARCHAR2(20),                   -- SUCCESS / FAILED
    log_text     CLOB
);


-- ============================================================
-- 4. RUNNER - executed by DBMS_SCHEDULER on every fire
-- ============================================================
CREATE OR REPLACE PROCEDURE wms_ai_job_runner (
    p_job_id IN NUMBER
) IS
    v_job        wms_ai_jobs%ROWTYPE;
    v_run_id     NUMBER;
    v_log        CLOB;
    v_step_cnt   NUMBER;
    v_ok         BOOLEAN := TRUE;

    -- extracted variables for #VAR# substitution
    TYPE t_vars IS TABLE OF VARCHAR2(4000) INDEX BY VARCHAR2(60);
    v_vars       t_vars;

    v_fusion_user VARCHAR2(400);
    v_fusion_pass VARCHAR2(400);
    v_fusion_inst VARCHAR2(10);
    v_fusion_base VARCHAR2(200);

    PROCEDURE logln (p_txt IN VARCHAR2) IS
    BEGIN
        v_log := v_log || TO_CHAR(SYSDATE, 'HH24:MI:SS') || '  ' || p_txt || CHR(10);
    END;

    FUNCTION subst (p_txt IN CLOB) RETURN CLOB IS
        v_out CLOB := p_txt;
        v_key VARCHAR2(60);
    BEGIN
        v_key := v_vars.FIRST;
        WHILE v_key IS NOT NULL LOOP
            v_out := REPLACE(v_out, '#' || v_key || '#', v_vars(v_key));
            v_key := v_vars.NEXT(v_key);
        END LOOP;
        RETURN v_out;
    END;

    -- guarded single-value SELECT (used by sql steps and completion_sql)
    FUNCTION eval_count (p_sql IN CLOB) RETURN NUMBER IS
        v_n NUMBER;
    BEGIN
        IF NOT REGEXP_LIKE(p_sql, '^\s*(SELECT|WITH)(\s|\()', 'i')
           OR REGEXP_LIKE(p_sql, '(^|\W)(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|EXECUTE|BEGIN|DECLARE|CALL|COMMIT|ROLLBACK)(\W|$)', 'i')
        THEN
            RAISE_APPLICATION_ERROR(-20001, 'SQL step must be a plain SELECT');
        END IF;
        EXECUTE IMMEDIATE 'SELECT COUNT(*) FROM (' || p_sql || ')' INTO v_n;
        RETURN v_n;
    END;

    PROCEDURE finish_job (p_status IN VARCHAR2) IS
    BEGIN
        UPDATE wms_ai_jobs SET status = p_status WHERE job_id = p_job_id;
        BEGIN
            DBMS_SCHEDULER.DISABLE('AI_JOB_' || p_job_id, force => TRUE);
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
    END;
BEGIN
    SELECT * INTO v_job FROM wms_ai_jobs WHERE job_id = p_job_id;

    -- terminal states never run again
    IF v_job.status IN ('COMPLETED', 'CANCELLED', 'EXPIRED') THEN
        BEGIN DBMS_SCHEDULER.DISABLE('AI_JOB_' || p_job_id, force => TRUE);
        EXCEPTION WHEN OTHERS THEN NULL; END;
        RETURN;
    END IF;

    -- safety caps
    IF v_job.runs_count >= NVL(v_job.max_runs, 50)
       OR (v_job.until_date IS NOT NULL AND SYSDATE > v_job.until_date) THEN
        finish_job('EXPIRED');
        COMMIT;
        RETURN;
    END IF;

    INSERT INTO wms_ai_job_runs (job_id, status) VALUES (p_job_id, 'RUNNING')
    RETURNING run_id INTO v_run_id;
    UPDATE wms_ai_jobs SET status = 'RUNNING', last_run_at = SYSDATE,
           runs_count = NVL(runs_count, 0) + 1
    WHERE job_id = p_job_id;
    COMMIT;

    logln('Run ' || v_run_id || ' started (run #' || (v_job.runs_count + 1) || ')');

    SELECT MAX(setting_value) INTO v_fusion_user FROM wms_ai_settings WHERE setting_key = 'FUSION_USERNAME';
    SELECT MAX(setting_value) INTO v_fusion_pass FROM wms_ai_settings WHERE setting_key = 'FUSION_PASSWORD';
    SELECT MAX(setting_value) INTO v_fusion_inst FROM wms_ai_settings WHERE setting_key = 'FUSION_INSTANCE';

    -- effective instance: job's own value wins, else the settings default
    v_fusion_inst := UPPER(NVL(v_job.instance, NVL(v_fusion_inst, 'PROD')));
    IF v_fusion_inst = 'TEST' THEN
        v_fusion_base := 'https://efmh-test.fa.em3.oraclecloud.com';
    ELSE
        v_fusion_base := 'https://efmh.fa.em3.oraclecloud.com';
    END IF;
    v_vars('FUSION_BASE') := v_fusion_base;   -- #FUSION_BASE# in step URLs/bodies
    logln('Fusion instance: ' || v_fusion_inst || ' (' || v_fusion_base || ')');

    -- TEST jobs use the TEST credential pair when both rows are set,
    -- otherwise they fall back to the main FUSION_USERNAME/PASSWORD
    IF v_fusion_inst = 'TEST' THEN
        DECLARE
            v_u VARCHAR2(400);
            v_p VARCHAR2(400);
        BEGIN
            SELECT MAX(setting_value) INTO v_u FROM wms_ai_settings WHERE setting_key = 'FUSION_USERNAME_TEST';
            SELECT MAX(setting_value) INTO v_p FROM wms_ai_settings WHERE setting_key = 'FUSION_PASSWORD_TEST';
            IF v_u IS NOT NULL AND v_p IS NOT NULL THEN
                v_fusion_user := v_u;
                v_fusion_pass := v_p;
                logln('Using TEST-specific Fusion credentials (' || v_u || ')');
            ELSE
                logln('No TEST-specific credentials set - using the main pair');
            END IF;
        END;
    END IF;

    APEX_JSON.parse(v_job.steps_json);
    v_step_cnt := NVL(APEX_JSON.get_count('steps'), 0);

    FOR i IN 1 .. v_step_cnt LOOP
        DECLARE
            v_type    VARCHAR2(20);
            v_method  VARCHAR2(10);
            v_url     CLOB;
            v_auth    VARCHAR2(20);
            v_body    CLOB;
            v_resp    CLOB;
            v_status  NUMBER;
            v_ecnt    NUMBER;
        BEGIN
            v_type := LOWER(NVL(APEX_JSON.get_varchar2('steps[%d].type', i), 'rest'));

            IF v_type = 'sql' THEN
                DECLARE
                    v_sql CLOB := APEX_JSON.get_clob('steps[%d].sql', i);
                    v_n   NUMBER;
                BEGIN
                    v_n := eval_count(subst(v_sql));
                    logln('Step ' || i || ' SQL -> ' || v_n || ' row(s)');
                END;
            ELSE
                v_method := UPPER(NVL(APEX_JSON.get_varchar2('steps[%d].method', i), 'GET'));
                v_url    := subst(APEX_JSON.get_clob('steps[%d].url', i));
                v_auth   := LOWER(NVL(APEX_JSON.get_varchar2('steps[%d].auth', i), 'none'));
                BEGIN
                    v_body := APEX_JSON.get_clob('steps[%d].body', i);
                EXCEPTION WHEN OTHERS THEN v_body := NULL;
                END;
                IF v_body IS NOT NULL THEN v_body := subst(v_body); END IF;

                -- host whitelist: own ORDS + the two Fusion hosts only
                IF NOT (   v_url LIKE 'https://g09254cbbf8e7af-graysprod.adb.eu-frankfurt-1.oraclecloudapps.com/%'
                        OR v_url LIKE 'https://efmh.fa.em3.oraclecloud.com/%'
                        OR v_url LIKE 'https://efmh-test.fa.em3.oraclecloud.com/%') THEN
                    RAISE_APPLICATION_ERROR(-20002, 'Step ' || i || ': URL host not in whitelist');
                END IF;

                apex_web_service.g_request_headers.DELETE;
                apex_web_service.g_request_headers(1).name  := 'Content-Type';
                apex_web_service.g_request_headers(1).value := 'application/json';

                IF v_auth = 'fusion' THEN
                    v_resp := APEX_WEB_SERVICE.MAKE_REST_REQUEST(
                        p_url => v_url, p_http_method => v_method, p_body => NVL(v_body, ''),
                        p_username => v_fusion_user, p_password => v_fusion_pass);
                ELSE
                    v_resp := APEX_WEB_SERVICE.MAKE_REST_REQUEST(
                        p_url => v_url, p_http_method => v_method, p_body => NVL(v_body, ''));
                END IF;
                v_status := apex_web_service.g_status_code;
                logln('Step ' || i || ' ' || v_method || ' ' || SUBSTR(v_url, 1, 200) ||
                      ' -> HTTP ' || v_status || ' (' || NVL(DBMS_LOB.GETLENGTH(v_resp), 0) || ' bytes)');
                logln('  resp: ' || SUBSTR(v_resp, 1, 500));

                IF v_status >= 400 THEN
                    RAISE_APPLICATION_ERROR(-20003, 'Step ' || i || ' failed with HTTP ' || v_status);
                END IF;

                -- extracts: { "VAR": "json.path" } - APEX_JSON paths, arrays are 1-based
                DECLARE
                    v_names apex_t_varchar2;
                BEGIN
                    APEX_JSON.parse(v_resp);
                    -- re-parse steps to read extract member names is awkward mid-loop:
                    -- read them from the original document via a second parser values table
                    NULL;
                END;
                DECLARE
                    v_members wwv_flow_t_varchar2;
                BEGIN
                    -- switch back to the steps document to list extract keys
                    APEX_JSON.parse(v_job.steps_json);
                    BEGIN
                        v_members := APEX_JSON.get_members('steps[%d].extract', i);
                    EXCEPTION WHEN OTHERS THEN v_members := NULL;
                    END;
                    IF v_members IS NOT NULL AND v_members.COUNT > 0 THEN
                        FOR k IN 1 .. v_members.COUNT LOOP
                            DECLARE
                                v_path VARCHAR2(500);
                                v_val  VARCHAR2(4000);
                            BEGIN
                                v_path := APEX_JSON.get_varchar2('steps[%d].extract.' || v_members(k), i);
                                APEX_JSON.parse(v_resp);
                                v_val := APEX_JSON.get_varchar2(v_path);
                                v_vars(UPPER(v_members(k))) := v_val;
                                logln('  extract ' || v_members(k) || ' = ' || NVL(v_val, '(null)'));
                                APEX_JSON.parse(v_job.steps_json);   -- restore for next step
                            END;
                        END LOOP;
                    END IF;
                END;
            END IF;
        END;
    END LOOP;

    -- completion check for REPEAT_UNTIL_DONE
    IF v_job.schedule_type = 'REPEAT_UNTIL_DONE' AND v_job.completion_sql IS NOT NULL THEN
        DECLARE
            v_remaining NUMBER;
        BEGIN
            v_remaining := eval_count(v_job.completion_sql);
            logln('Completion check: ' || v_remaining || ' remaining');
            IF v_remaining = 0 THEN
                finish_job('COMPLETED');
                logln('Goal reached - job COMPLETED');
            ELSE
                UPDATE wms_ai_jobs SET status = 'SCHEDULED' WHERE job_id = p_job_id;
            END IF;
        END;
    ELSIF v_job.schedule_type = 'ONCE' THEN
        finish_job('COMPLETED');
        logln('One-shot job COMPLETED');
    ELSE
        UPDATE wms_ai_jobs SET status = 'SCHEDULED' WHERE job_id = p_job_id;
    END IF;

    UPDATE wms_ai_job_runs
    SET finished_at = SYSDATE, status = 'SUCCESS', log_text = v_log
    WHERE run_id = v_run_id;
    UPDATE wms_ai_jobs SET last_error = NULL WHERE job_id = p_job_id;
    COMMIT;
EXCEPTION
    WHEN OTHERS THEN
        DECLARE
            v_err VARCHAR2(4000) := SUBSTR(SQLERRM, 1, 4000);
        BEGIN
            logln('FAILED: ' || v_err);
            IF v_run_id IS NOT NULL THEN
                UPDATE wms_ai_job_runs
                SET finished_at = SYSDATE, status = 'FAILED', log_text = v_log
                WHERE run_id = v_run_id;
            END IF;
            UPDATE wms_ai_jobs
            SET status = CASE WHEN schedule_type = 'ONCE' THEN 'FAILED' ELSE 'SCHEDULED' END,
                last_error = v_err
            WHERE job_id = p_job_id;
            COMMIT;
        END;
END wms_ai_job_runner;
/


-- ============================================================
-- 5. CREATE JOB (called by POST ai/jobs/create)
-- ============================================================
CREATE OR REPLACE PROCEDURE wms_ai_job_create (
    p_body IN CLOB
) IS
    v_job_id     NUMBER;
    v_name       VARCHAR2(200);
    v_desc       VARCHAR2(1000);
    v_type       VARCHAR2(20);
    v_start_at   DATE;
    v_interval   NUMBER;
    v_completion CLOB;
    v_max_runs   NUMBER;
    v_until      DATE;
    v_instance   VARCHAR2(10);
    v_by         VARCHAR2(100);
    v_machine    VARCHAR2(100);
    v_steps      CLOB;
    v_step_cnt   NUMBER;
    v_sched_name VARCHAR2(60);
BEGIN
    APEX_JSON.parse(p_body);
    v_name       := APEX_JSON.get_varchar2('name');
    v_desc       := APEX_JSON.get_varchar2('description');
    v_type       := NVL(UPPER(APEX_JSON.get_varchar2('scheduleType')), 'ONCE');
    v_interval   := APEX_JSON.get_number('intervalMinutes');
    v_completion := APEX_JSON.get_clob('completionSql');
    v_max_runs   := LEAST(NVL(APEX_JSON.get_number('maxRuns'), 50), 200);
    v_instance   := UPPER(APEX_JSON.get_varchar2('instance'));
    IF v_instance IS NULL THEN
        SELECT MAX(setting_value) INTO v_instance
        FROM wms_ai_settings WHERE setting_key = 'FUSION_INSTANCE';
        v_instance := NVL(UPPER(v_instance), 'PROD');
    END IF;
    IF v_instance NOT IN ('PROD', 'TEST') THEN v_instance := 'PROD'; END IF;
    v_by         := NVL(APEX_JSON.get_varchar2('createdBy'), 'UNKNOWN');
    v_machine    := NVL(APEX_JSON.get_varchar2('createdMachine'), 'UNKNOWN');

    BEGIN
        v_start_at := TO_DATE(APEX_JSON.get_varchar2('startAt'), 'YYYY-MM-DD HH24:MI');
    EXCEPTION WHEN OTHERS THEN v_start_at := SYSDATE;
    END;
    IF v_start_at IS NULL OR v_start_at < SYSDATE THEN v_start_at := SYSDATE; END IF;

    BEGIN
        v_until := TO_DATE(APEX_JSON.get_varchar2('untilDate'), 'YYYY-MM-DD');
    EXCEPTION WHEN OTHERS THEN v_until := NULL;
    END;
    IF v_until IS NULL THEN v_until := SYSDATE + 7; END IF;
    IF v_until > SYSDATE + 30 THEN v_until := SYSDATE + 30; END IF;

    IF v_type <> 'ONCE' THEN
        IF v_interval IS NULL OR v_interval < 2 THEN v_interval := 2; END IF;
    END IF;

    v_step_cnt := NVL(APEX_JSON.get_count('steps'), 0);
    IF v_name IS NULL OR v_step_cnt = 0 THEN
        APEX_JSON.open_object;
        APEX_JSON.write('success', FALSE);
        APEX_JSON.write('error', 'name and at least one step are required');
        APEX_JSON.close_object;
        RETURN;
    END IF;

    -- store steps as {"steps":[...]} - re-extract the raw array from the request
    v_steps := '{"steps":' ||
               REGEXP_SUBSTR(p_body, '"steps"\s*:\s*(\[.*\])', 1, 1, 'n', 1) || '}';

    INSERT INTO wms_ai_jobs
        (job_name, description, steps_json, schedule_type, start_at, interval_minutes,
         completion_sql, max_runs, until_date, instance, created_by, created_machine)
    VALUES
        (v_name, v_desc, v_steps, v_type, v_start_at, v_interval,
         v_completion, v_max_runs, v_until, v_instance, v_by, v_machine)
    RETURNING job_id INTO v_job_id;

    v_sched_name := 'AI_JOB_' || v_job_id;
    IF v_type = 'ONCE' THEN
        DBMS_SCHEDULER.CREATE_JOB(
            job_name   => v_sched_name,
            job_type   => 'PLSQL_BLOCK',
            job_action => 'BEGIN wms_ai_job_runner(' || v_job_id || '); END;',
            start_date => CAST(v_start_at AS TIMESTAMP),
            enabled    => TRUE,
            auto_drop  => TRUE);
    ELSE
        DBMS_SCHEDULER.CREATE_JOB(
            job_name        => v_sched_name,
            job_type        => 'PLSQL_BLOCK',
            job_action      => 'BEGIN wms_ai_job_runner(' || v_job_id || '); END;',
            start_date      => CAST(v_start_at AS TIMESTAMP),
            repeat_interval => 'FREQ=MINUTELY;INTERVAL=' || v_interval,
            end_date        => CAST(v_until AS TIMESTAMP),
            enabled         => TRUE,
            auto_drop       => FALSE);
    END IF;

    COMMIT;
    APEX_JSON.open_object;
    APEX_JSON.write('success', TRUE);
    APEX_JSON.write('jobId', v_job_id);
    APEX_JSON.write('jobName', v_sched_name);
    APEX_JSON.write('firstRun', TO_CHAR(v_start_at, 'YYYY-MM-DD HH24:MI:SS'));
    APEX_JSON.close_object;
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        APEX_JSON.open_object;
        APEX_JSON.write('success', FALSE);
        APEX_JSON.write('error', SQLERRM);
        APEX_JSON.close_object;
END wms_ai_job_create;
/


-- ============================================================
-- 6. CANCEL JOB
-- ============================================================
CREATE OR REPLACE PROCEDURE wms_ai_job_cancel (
    p_body IN CLOB
) IS
    v_id NUMBER;
BEGIN
    APEX_JSON.parse(p_body);
    v_id := APEX_JSON.get_number('jobId');
    BEGIN
        DBMS_SCHEDULER.DROP_JOB('AI_JOB_' || v_id, force => TRUE);
    EXCEPTION WHEN OTHERS THEN NULL;  -- already dropped / never existed
    END;
    UPDATE wms_ai_jobs SET status = 'CANCELLED' WHERE job_id = v_id
      AND status NOT IN ('COMPLETED');
    COMMIT;
    APEX_JSON.open_object;
    APEX_JSON.write('success', TRUE);
    APEX_JSON.close_object;
EXCEPTION
    WHEN OTHERS THEN
        APEX_JSON.open_object;
        APEX_JSON.write('success', FALSE);
        APEX_JSON.write('error', SQLERRM);
        APEX_JSON.close_object;
END wms_ai_job_cancel;
/


-- ============================================================
-- 7. RUN NOW
-- ============================================================
CREATE OR REPLACE PROCEDURE wms_ai_job_runnow (
    p_body IN CLOB
) IS
    v_id NUMBER;
BEGIN
    APEX_JSON.parse(p_body);
    v_id := APEX_JSON.get_number('jobId');
    -- run in a background scheduler session so the HTTP call returns fast
    BEGIN
        DBMS_SCHEDULER.RUN_JOB('AI_JOB_' || v_id, use_current_session => FALSE);
    EXCEPTION
        WHEN OTHERS THEN
            -- job may be a completed ONCE job (already dropped): run directly
            wms_ai_job_runner(v_id);
    END;
    APEX_JSON.open_object;
    APEX_JSON.write('success', TRUE);
    APEX_JSON.close_object;
EXCEPTION
    WHEN OTHERS THEN
        APEX_JSON.open_object;
        APEX_JSON.write('success', FALSE);
        APEX_JSON.write('error', SQLERRM);
        APEX_JSON.close_object;
END wms_ai_job_runnow;
/


-- ============================================================
-- REST HANDLERS (module WAREHOUSEMANAGEMENT, Source Type PL/SQL)
-- ============================================================

-- ============================================================
-- HANDLER 1: POST ai/jobs/create
-- ============================================================
BEGIN
    wms_ai_job_create(:body_text);
END;


-- ============================================================
-- HANDLER 2: POST ai/jobs/cancel        {"jobId": 1}
-- ============================================================
BEGIN
    wms_ai_job_cancel(:body_text);
END;


-- ============================================================
-- HANDLER 3: POST ai/jobs/runnow        {"jobId": 1}
-- ============================================================
BEGIN
    wms_ai_job_runnow(:body_text);
END;


-- ============================================================
-- HANDLER 4: GET ai/jobs/list?fromdate=YYYY-MM-DD&todate=YYYY-MM-DD&status=
-- Add THREE handler parameters (Source Type URI, IN, STRING):
--   Name=fromdate Bind=fromdate | Name=todate Bind=todate | Name=status Bind=status
-- ============================================================
DECLARE
    v_from   DATE;
    v_to     DATE;
    v_status VARCHAR2(20) := UPPER(TRIM(:status));
BEGIN
    BEGIN v_from := TO_DATE(:fromdate, 'YYYY-MM-DD'); EXCEPTION WHEN OTHERS THEN v_from := NULL; END;
    BEGIN v_to   := TO_DATE(:todate,   'YYYY-MM-DD'); EXCEPTION WHEN OTHERS THEN v_to   := NULL; END;

    APEX_JSON.open_object;
    APEX_JSON.open_array('jobs');
    FOR r IN (SELECT j.*,
                     (SELECT TO_CHAR(s.next_run_date, 'YYYY-MM-DD HH24:MI:SS')
                      FROM user_scheduler_jobs s
                      WHERE s.job_name = 'AI_JOB_' || j.job_id) AS next_run
              FROM wms_ai_jobs j
              WHERE (v_from IS NULL OR j.created_date >= v_from)
                AND (v_to   IS NULL OR j.created_date <  v_to + 1)
                AND (v_status IS NULL OR v_status = '' OR j.status = v_status)
              ORDER BY j.created_date DESC) LOOP
        APEX_JSON.open_object;
        APEX_JSON.write('jobId',        r.job_id);
        APEX_JSON.write('name',         r.job_name);
        APEX_JSON.write('description',  r.description);
        APEX_JSON.write('scheduleType', r.schedule_type);
        APEX_JSON.write('status',       r.status);
        APEX_JSON.write('intervalMinutes', r.interval_minutes);
        APEX_JSON.write('createdBy',    r.created_by);
        APEX_JSON.write('createdMachine', r.created_machine);
        APEX_JSON.write('createdDate',  TO_CHAR(r.created_date, 'YYYY-MM-DD HH24:MI'));
        APEX_JSON.write('runsCount',    NVL(r.runs_count, 0));
        APEX_JSON.write('lastRunAt',    TO_CHAR(r.last_run_at, 'YYYY-MM-DD HH24:MI:SS'));
        APEX_JSON.write('nextRun',      r.next_run);
        APEX_JSON.write('lastError',    r.last_error);
        APEX_JSON.close_object;
    END LOOP;
    APEX_JSON.close_array;
    APEX_JSON.close_object;
END;


-- ============================================================
-- HANDLER 5: GET ai/jobs/get?id=1
-- Add handler parameter: Name=id, Bind=id, Source=URI, IN, STRING
-- ============================================================
DECLARE
    v_id NUMBER := TO_NUMBER(:id);
BEGIN
    FOR r IN (SELECT j.*,
                     (SELECT TO_CHAR(s.next_run_date, 'YYYY-MM-DD HH24:MI:SS')
                      FROM user_scheduler_jobs s
                      WHERE s.job_name = 'AI_JOB_' || j.job_id) AS next_run
              FROM wms_ai_jobs j WHERE j.job_id = v_id) LOOP
        APEX_JSON.open_object;
        APEX_JSON.write('jobId',        r.job_id);
        APEX_JSON.write('name',         r.job_name);
        APEX_JSON.write('description',  r.description);
        APEX_JSON.write('stepsJson',    r.steps_json);
        APEX_JSON.write('scheduleType', r.schedule_type);
        APEX_JSON.write('startAt',      TO_CHAR(r.start_at, 'YYYY-MM-DD HH24:MI'));
        APEX_JSON.write('intervalMinutes', r.interval_minutes);
        APEX_JSON.write('completionSql', r.completion_sql);
        APEX_JSON.write('maxRuns',      r.max_runs);
        APEX_JSON.write('untilDate',    TO_CHAR(r.until_date, 'YYYY-MM-DD'));
        APEX_JSON.write('status',       r.status);
        APEX_JSON.write('instance',     r.instance);
        APEX_JSON.write('createdBy',    r.created_by);
        APEX_JSON.write('createdMachine', r.created_machine);
        APEX_JSON.write('createdDate',  TO_CHAR(r.created_date, 'YYYY-MM-DD HH24:MI:SS'));
        APEX_JSON.write('runsCount',    NVL(r.runs_count, 0));
        APEX_JSON.write('lastRunAt',    TO_CHAR(r.last_run_at, 'YYYY-MM-DD HH24:MI:SS'));
        APEX_JSON.write('nextRun',      r.next_run);
        APEX_JSON.write('lastError',    r.last_error);
        APEX_JSON.open_array('runs');
        FOR rr IN (SELECT * FROM (
                       SELECT * FROM wms_ai_job_runs
                       WHERE job_id = v_id ORDER BY run_id DESC)
                   WHERE ROWNUM <= 20) LOOP
            APEX_JSON.open_object;
            APEX_JSON.write('runId',      rr.run_id);
            APEX_JSON.write('startedAt',  TO_CHAR(rr.started_at, 'YYYY-MM-DD HH24:MI:SS'));
            APEX_JSON.write('finishedAt', TO_CHAR(rr.finished_at, 'YYYY-MM-DD HH24:MI:SS'));
            APEX_JSON.write('status',     rr.status);
            APEX_JSON.write('log',        rr.log_text);
            APEX_JSON.close_object;
        END LOOP;
        APEX_JSON.close_array;
        APEX_JSON.close_object;
        RETURN;
    END LOOP;
    APEX_JSON.open_object;
    APEX_JSON.write('success', FALSE);
    APEX_JSON.write('error', 'Job not found');
    APEX_JSON.close_object;
END;
