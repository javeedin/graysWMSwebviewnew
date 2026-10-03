-- ============================================================================
-- 74_ai_safety_fixes.sql - AI Digital Employee safety fixes (phase A)
-- ----------------------------------------------------------------------------
-- Run once in SQL Workshop / SQL Developer as the APEX schema owner.
--
-- 1. db_write on TEST = the same rule as PROD.
--    There is only ONE APEX database: the PROD/TEST switch selects the Fusion
--    pod, not a different database, so a "TEST sandbox" AUTO rule let the chat
--    change production tables without an approval card. Every TEST db_write
--    rule now copies the PROD rule of the same user (DENY when there is none).
--    The host (ClaudeCliService.SINGLE_DB_ACTIONS) also resolves db_write with
--    the PROD rules, so this holds even if a TEST row is added again later.
--
-- 2. LOCAL job leases: a LOCAL job is RUNNING while one app executes it. If
--    that app closes or crashes mid-run the job used to stay RUNNING forever
--    (the claim only accepts SCHEDULED jobs). A scheduler job now releases
--    LOCAL jobs whose open run is older than 30 minutes: the run is marked
--    FAILED ("lease expired") and the job goes back to SCHEDULED.
-- ============================================================================

-- 1. db_write TEST = PROD --------------------------------------------------
UPDATE wms_ai_policies t
   SET policy_mode  = NVL((SELECT p.policy_mode FROM wms_ai_policies p
                            WHERE p.action_key = 'db_write' AND p.instance = 'PROD' AND p.app_user = t.app_user), 'DENY'),
       max_batch    = NULL,
       note         = 'Same as PROD: one APEX database (74_ai_safety_fixes)',
       updated_by   = 'SCRIPT74',
       updated_date = SYSDATE
 WHERE t.action_key = 'db_write'
   AND t.instance   = 'TEST';

-- rules for '*' (all instances) stay as they are; check what is left:
-- SELECT app_user, instance, policy_mode, note FROM wms_ai_policies WHERE action_key = 'db_write' ORDER BY app_user, instance;

COMMIT;

-- 2. LOCAL job leases ---------------------------------------------------------
CREATE OR REPLACE PROCEDURE wms_ai_job_local_recover (
    p_lease_minutes IN NUMBER DEFAULT 30
) IS
BEGIN
    FOR j IN (SELECT job_id FROM wms_ai_jobs
               WHERE lane = 'LOCAL' AND status = 'RUNNING'
                 AND NOT EXISTS (SELECT 1 FROM wms_ai_job_runs r
                                  WHERE r.job_id = wms_ai_jobs.job_id AND r.status = 'RUNNING'
                                    AND r.started_at > SYSDATE - p_lease_minutes / 1440))
    LOOP
        UPDATE wms_ai_job_runs
           SET status = 'FAILED', finished_at = SYSDATE,
               log_text = log_text || CHR(10) || 'Lease expired after ' || p_lease_minutes ||
                          ' min - the app running it closed or stopped. Released for the next run.'
         WHERE job_id = j.job_id AND status = 'RUNNING';
        UPDATE wms_ai_jobs SET status = 'SCHEDULED' WHERE job_id = j.job_id AND status = 'RUNNING';
    END LOOP;
    COMMIT;
END wms_ai_job_local_recover;
/

BEGIN
    BEGIN DBMS_SCHEDULER.drop_job('WMS_AI_LOCAL_RECOVER', force => TRUE); EXCEPTION WHEN OTHERS THEN NULL; END;
    DBMS_SCHEDULER.create_job(
        job_name        => 'WMS_AI_LOCAL_RECOVER',
        job_type        => 'STORED_PROCEDURE',
        job_action      => 'WMS_AI_JOB_LOCAL_RECOVER',
        start_date      => SYSTIMESTAMP,
        repeat_interval => 'FREQ=MINUTELY;INTERVAL=10',
        enabled         => TRUE,
        comments        => 'Releases LOCAL AI jobs stuck in RUNNING (74_ai_safety_fixes.sql)');
END;
/
