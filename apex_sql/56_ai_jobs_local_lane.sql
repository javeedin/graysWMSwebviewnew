-- ============================================================
-- 56 — AI JOBS: FRONTEND ("LOCAL") LANE
-- ============================================================
-- Adds a second scheduling lane to the existing wms_ai_jobs system.
--
--   lane = 'DB'    (default, unchanged) -> runs inside Oracle via
--                  DBMS_SCHEDULER (wms_ai_job_runner). App can be closed.
--   lane = 'LOCAL' -> NO scheduler job is created. The desktop app polls
--                  for due LOCAL jobs, runs their steps itself (printing,
--                  PDF download, email, local files, REST from the PC),
--                  and reports each run back here — so the frontend can
--                  monitor them exactly like DB jobs (runs, status, next run).
--
-- This script is ADDITIVE: existing DB-lane jobs behave exactly as before.
-- Run it once in the WKSP_GRAYSAPP parsing schema (SQL Developer / SQL*Plus),
-- then update the 3 ORDS handler sources noted at the bottom and add the
-- 3 new handlers.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Column: which lane a job runs in
-- ------------------------------------------------------------
DECLARE
    v_exists NUMBER;
BEGIN
    SELECT COUNT(*) INTO v_exists
    FROM user_tab_columns
    WHERE table_name = 'WMS_AI_JOBS' AND column_name = 'LANE';
    IF v_exists = 0 THEN
        EXECUTE IMMEDIATE 'ALTER TABLE wms_ai_jobs ADD (lane VARCHAR2(10) DEFAULT ''DB'' NOT NULL)';
        EXECUTE IMMEDIATE 'ALTER TABLE wms_ai_jobs ADD CONSTRAINT wms_ai_jobs_lane_ck CHECK (lane IN (''DB'',''LOCAL''))';
    END IF;
END;
/

-- ------------------------------------------------------------
-- 2) CREATE a LOCAL (frontend) job — no DBMS_SCHEDULER job
-- ------------------------------------------------------------
CREATE OR REPLACE PROCEDURE wms_ai_local_job_create (
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
BEGIN
    APEX_JSON.parse(p_body);
    v_name       := APEX_JSON.get_varchar2('name');
    v_desc       := APEX_JSON.get_varchar2('description');
    v_type       := NVL(UPPER(APEX_JSON.get_varchar2('scheduleType')), 'ONCE');
    v_interval   := APEX_JSON.get_number('intervalMinutes');
    v_completion := APEX_JSON.get_clob('completionSql');
    v_max_runs   := LEAST(NVL(APEX_JSON.get_number('maxRuns'), 50), 500);
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
        IF v_interval IS NULL OR v_interval < 1 THEN v_interval := 1; END IF;
    END IF;

    v_step_cnt := NVL(APEX_JSON.get_count('steps'), 0);
    IF v_name IS NULL OR v_step_cnt = 0 THEN
        APEX_JSON.open_object;
        APEX_JSON.write('success', FALSE);
        APEX_JSON.write('error', 'name and at least one step are required');
        APEX_JSON.close_object;
        RETURN;
    END IF;

    v_steps := '{"steps":' ||
               REGEXP_SUBSTR(p_body, '"steps"\s*:\s*(\[.*\])', 1, 1, 'n', 1) || '}';

    INSERT INTO wms_ai_jobs
        (job_name, description, steps_json, schedule_type, start_at, interval_minutes,
         completion_sql, max_runs, until_date, instance, created_by, created_machine, lane, status)
    VALUES
        (v_name, v_desc, v_steps, v_type, v_start_at, v_interval,
         v_completion, v_max_runs, v_until, v_instance, v_by, v_machine, 'LOCAL', 'SCHEDULED')
    RETURNING job_id INTO v_job_id;

    COMMIT;
    APEX_JSON.open_object;
    APEX_JSON.write('success', TRUE);
    APEX_JSON.write('jobId', v_job_id);
    APEX_JSON.write('lane', 'LOCAL');
    APEX_JSON.write('firstRun', TO_CHAR(v_start_at, 'YYYY-MM-DD HH24:MI:SS'));
    APEX_JSON.close_object;
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        APEX_JSON.open_object;
        APEX_JSON.write('success', FALSE);
        APEX_JSON.write('error', SQLERRM);
        APEX_JSON.close_object;
END wms_ai_local_job_create;
/

-- ------------------------------------------------------------
-- 3) CLAIM a due LOCAL job (atomic — prevents two open apps double-running)
--    body: { "jobId": 1, "machine": "PC-01" }
--    returns { claimed, runId, stepsJson, completionSql, instance, scheduleType }
-- ------------------------------------------------------------
CREATE OR REPLACE PROCEDURE wms_ai_job_localclaim (
    p_body IN CLOB
) IS
    v_id      NUMBER;
    v_machine VARCHAR2(100);
    v_job     wms_ai_jobs%ROWTYPE;
    v_due     BOOLEAN := FALSE;
    v_next    DATE;
    v_run_id  NUMBER;
BEGIN
    APEX_JSON.parse(p_body);
    v_id      := APEX_JSON.get_number('jobId');
    v_machine := NVL(APEX_JSON.get_varchar2('machine'), 'UNKNOWN');

    SELECT * INTO v_job FROM wms_ai_jobs WHERE job_id = v_id AND lane = 'LOCAL' FOR UPDATE;

    -- terminal / expiry checks
    IF v_job.status NOT IN ('SCHEDULED') THEN
        ROLLBACK;
        APEX_JSON.open_object; APEX_JSON.write('claimed', FALSE);
        APEX_JSON.write('reason', 'status ' || v_job.status); APEX_JSON.close_object; RETURN;
    END IF;
    IF NVL(v_job.runs_count,0) >= v_job.max_runs OR (v_job.until_date IS NOT NULL AND v_job.until_date < SYSDATE) THEN
        UPDATE wms_ai_jobs SET status = CASE WHEN until_date < SYSDATE THEN 'EXPIRED' ELSE 'COMPLETED' END
        WHERE job_id = v_id;
        COMMIT;
        APEX_JSON.open_object; APEX_JSON.write('claimed', FALSE);
        APEX_JSON.write('reason', 'expired/maxed'); APEX_JSON.close_object; RETURN;
    END IF;

    -- due?  first run at start_at; later runs at last_run_at + interval
    IF v_job.last_run_at IS NULL THEN
        v_next := v_job.start_at;
    ELSIF v_job.schedule_type = 'ONCE' THEN
        v_next := NULL;   -- ONCE already ran
    ELSE
        v_next := v_job.last_run_at + (NVL(v_job.interval_minutes,1) / 1440);
    END IF;
    IF v_next IS NOT NULL AND SYSDATE >= v_next THEN v_due := TRUE; END IF;

    IF NOT v_due THEN
        ROLLBACK;
        APEX_JSON.open_object; APEX_JSON.write('claimed', FALSE);
        APEX_JSON.write('reason', 'not due');
        APEX_JSON.write('nextRun', TO_CHAR(v_next, 'YYYY-MM-DD HH24:MI:SS'));
        APEX_JSON.close_object; RETURN;
    END IF;

    -- claim: flip to RUNNING, open a run row, bump the counter
    UPDATE wms_ai_jobs SET status = 'RUNNING', runs_count = NVL(runs_count,0) + 1,
           created_machine = created_machine    -- (no-op; keep original creator)
    WHERE job_id = v_id;

    INSERT INTO wms_ai_job_runs (job_id, started_at, status, log_text)
    VALUES (v_id, SYSDATE, 'RUNNING', 'claimed by ' || v_machine)
    RETURNING run_id INTO v_run_id;

    COMMIT;
    APEX_JSON.open_object;
    APEX_JSON.write('claimed', TRUE);
    APEX_JSON.write('runId', v_run_id);
    APEX_JSON.write('jobId', v_id);
    APEX_JSON.write('scheduleType', v_job.schedule_type);
    APEX_JSON.write('instance', v_job.instance);
    APEX_JSON.write('stepsJson', v_job.steps_json);
    APEX_JSON.write('completionSql', v_job.completion_sql);
    APEX_JSON.close_object;
EXCEPTION
    WHEN NO_DATA_FOUND THEN
        APEX_JSON.open_object; APEX_JSON.write('claimed', FALSE);
        APEX_JSON.write('reason', 'not found'); APEX_JSON.close_object;
    WHEN OTHERS THEN
        ROLLBACK;
        APEX_JSON.open_object; APEX_JSON.write('claimed', FALSE);
        APEX_JSON.write('reason', SQLERRM); APEX_JSON.close_object;
END wms_ai_job_localclaim;
/

-- ------------------------------------------------------------
-- 4) REPORT the result of a LOCAL run (the app calls this when a run ends)
--    body: { "jobId":1, "runId":9, "status":"SUCCESS"|"FAILED",
--            "log":"...", "done":true|false, "error":"..." }
--    Advances the header: SCHEDULED (more to go) / COMPLETED / EXPIRED.
-- ------------------------------------------------------------
CREATE OR REPLACE PROCEDURE wms_ai_job_localreport (
    p_body IN CLOB
) IS
    v_id     NUMBER;
    v_run    NUMBER;
    v_status VARCHAR2(20);
    v_log    CLOB;
    v_done   VARCHAR2(10);
    v_error  VARCHAR2(4000);
    v_job    wms_ai_jobs%ROWTYPE;
    v_new    VARCHAR2(20);
BEGIN
    APEX_JSON.parse(p_body);
    v_id     := APEX_JSON.get_number('jobId');
    v_run    := APEX_JSON.get_number('runId');
    v_status := NVL(UPPER(APEX_JSON.get_varchar2('status')), 'SUCCESS');
    v_log    := APEX_JSON.get_clob('log');
    v_done   := LOWER(NVL(APEX_JSON.get_varchar2('done'), 'false'));
    v_error  := SUBSTR(APEX_JSON.get_varchar2('error'), 1, 4000);

    UPDATE wms_ai_job_runs
    SET finished_at = SYSDATE, status = v_status, log_text = v_log
    WHERE run_id = v_run AND job_id = v_id;

    SELECT * INTO v_job FROM wms_ai_jobs WHERE job_id = v_id FOR UPDATE;

    IF v_job.schedule_type = 'ONCE' THEN
        v_new := 'COMPLETED';
    ELSIF v_done IN ('true', 'y', 'yes', '1') THEN
        v_new := 'COMPLETED';
    ELSIF NVL(v_job.runs_count,0) >= v_job.max_runs THEN
        v_new := 'COMPLETED';
    ELSIF v_job.until_date IS NOT NULL AND v_job.until_date < SYSDATE THEN
        v_new := 'EXPIRED';
    ELSE
        v_new := 'SCHEDULED';
    END IF;

    UPDATE wms_ai_jobs
    SET status = v_new, last_run_at = SYSDATE,
        last_error = CASE WHEN v_status = 'FAILED' THEN v_error ELSE last_error END
    WHERE job_id = v_id;

    COMMIT;
    APEX_JSON.open_object;
    APEX_JSON.write('success', TRUE);
    APEX_JSON.write('status', v_new);
    APEX_JSON.close_object;
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        APEX_JSON.open_object;
        APEX_JSON.write('success', FALSE);
        APEX_JSON.write('error', SQLERRM);
        APEX_JSON.close_object;
END wms_ai_job_localreport;
/

-- ------------------------------------------------------------
-- 5) CANCEL — make it LANE-AWARE (LOCAL jobs have no scheduler job to drop)
--    Replaces the body of wms_ai_job_cancel from script 38.
-- ------------------------------------------------------------
CREATE OR REPLACE PROCEDURE wms_ai_job_cancel (
    p_body IN CLOB
) IS
    v_id   NUMBER;
    v_lane VARCHAR2(10);
    v_cnt  NUMBER;
BEGIN
    APEX_JSON.parse(p_body);
    v_id := APEX_JSON.get_number('jobId');

    SELECT lane INTO v_lane FROM wms_ai_jobs WHERE job_id = v_id;

    IF v_lane = 'DB' THEN
        SELECT COUNT(*) INTO v_cnt FROM user_scheduler_jobs WHERE job_name = 'AI_JOB_' || v_id;
        IF v_cnt > 0 THEN
            BEGIN DBMS_SCHEDULER.DROP_JOB('AI_JOB_' || v_id, force => TRUE);
            EXCEPTION WHEN OTHERS THEN NULL; END;
        END IF;
    END IF;

    UPDATE wms_ai_jobs SET status = 'CANCELLED' WHERE job_id = v_id;
    COMMIT;
    APEX_JSON.open_object;
    APEX_JSON.write('success', TRUE);
    APEX_JSON.write('jobId', v_id);
    APEX_JSON.close_object;
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        APEX_JSON.open_object;
        APEX_JSON.write('success', FALSE);
        APEX_JSON.write('error', SQLERRM);
        APEX_JSON.close_object;
END wms_ai_job_cancel;
/

-- ============================================================
-- ORDS — add THREE new handlers (module WAREHOUSEMANAGEMENT, Source Type PL/SQL)
-- ============================================================
-- NEW HANDLER: POST ai/jobs/localcreate
--   BEGIN wms_ai_local_job_create(:body_text); END;
--
-- NEW HANDLER: POST ai/jobs/localclaim
--   BEGIN wms_ai_job_localclaim(:body_text); END;
--
-- NEW HANDLER: POST ai/jobs/localreport
--   BEGIN wms_ai_job_localreport(:body_text); END;
--
-- ============================================================
-- ORDS — UPDATE the existing GET ai/jobs/list handler source so LOCAL jobs
-- are included with their lane + a computed nextRun. Replace HANDLER 4 body
-- from script 38 with the block below (same 3 URI params: fromdate/todate/status;
-- add an optional 4th: Name=lane Bind=lane Source=URI IN STRING).
-- ============================================================
--  DECLARE
--      v_from   DATE;
--      v_to     DATE;
--      v_status VARCHAR2(20) := UPPER(TRIM(:status));
--      v_lane   VARCHAR2(10) := UPPER(TRIM(:lane));
--  BEGIN
--      BEGIN v_from := TO_DATE(:fromdate, 'YYYY-MM-DD'); EXCEPTION WHEN OTHERS THEN v_from := NULL; END;
--      BEGIN v_to   := TO_DATE(:todate,   'YYYY-MM-DD'); EXCEPTION WHEN OTHERS THEN v_to   := NULL; END;
--      APEX_JSON.open_object;
--      APEX_JSON.open_array('jobs');
--      FOR r IN (SELECT j.*,
--                       CASE WHEN j.lane = 'LOCAL' THEN
--                            CASE WHEN j.status = 'SCHEDULED' THEN
--                                 TO_CHAR(NVL(j.last_run_at + NVL(j.interval_minutes,1)/1440, j.start_at),
--                                         'YYYY-MM-DD HH24:MI:SS') END
--                       ELSE (SELECT TO_CHAR(s.next_run_date, 'YYYY-MM-DD HH24:MI:SS')
--                             FROM user_scheduler_jobs s WHERE s.job_name = 'AI_JOB_' || j.job_id)
--                       END AS next_run
--                FROM wms_ai_jobs j
--                WHERE (v_from   IS NULL OR j.created_date >= v_from)
--                  AND (v_to     IS NULL OR j.created_date <  v_to + 1)
--                  AND (v_status IS NULL OR v_status = '' OR j.status = v_status)
--                  AND (v_lane   IS NULL OR v_lane   = '' OR j.lane   = v_lane)
--                ORDER BY j.created_date DESC) LOOP
--          APEX_JSON.open_object;
--          APEX_JSON.write('jobId',        r.job_id);
--          APEX_JSON.write('name',         r.job_name);
--          APEX_JSON.write('description',  r.description);
--          APEX_JSON.write('lane',         r.lane);
--          APEX_JSON.write('scheduleType', r.schedule_type);
--          APEX_JSON.write('status',       r.status);
--          APEX_JSON.write('intervalMinutes', r.interval_minutes);
--          APEX_JSON.write('instance',     r.instance);
--          APEX_JSON.write('createdBy',    r.created_by);
--          APEX_JSON.write('createdMachine', r.created_machine);
--          APEX_JSON.write('createdDate',  TO_CHAR(r.created_date, 'YYYY-MM-DD HH24:MI'));
--          APEX_JSON.write('runsCount',    NVL(r.runs_count, 0));
--          APEX_JSON.write('maxRuns',      r.max_runs);
--          APEX_JSON.write('lastRunAt',    TO_CHAR(r.last_run_at, 'YYYY-MM-DD HH24:MI:SS'));
--          APEX_JSON.write('nextRun',      r.next_run);
--          APEX_JSON.write('lastError',    r.last_error);
--          APEX_JSON.close_object;
--      END LOOP;
--      APEX_JSON.close_array;
--      APEX_JSON.close_object;
--  END;
-- ============================================================
-- (Optional) Also add  APEX_JSON.write('lane', r.lane);  and stepsJson to the
-- GET ai/jobs/get handler (HANDLER 5) so the monitor can show the lane there too.
-- The frontend runner reads steps from ai/jobs/localclaim, so this is display-only.
-- ============================================================
