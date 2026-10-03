-- ============================================================
-- 67_trial_period.sql
-- ONE trial period shared by the trial modules:
--   * AI Digital Employee  (aianalysis/)
--   * Fusion SQL           (fusionsql/)
-- Both pages load Home/trial-gate.js, which reads the single row
-- of WMS_AI_TRIAL through ai/executequery:
--   active = 'Y' and SYSDATE <= trial_end -> "TRIAL · N days left" badge
--   active = 'Y' and SYSDATE >  trial_end -> module locked ("Trial period ended")
--   active = 'N'                          -> no gate (licensed)
-- The Home launcher shows the same countdown on both tiles.
-- On a query error the gate fails open (never locks users out).
-- ============================================================

-- 1. Table (skipped if it already exists)
DECLARE
    n NUMBER;
BEGIN
    SELECT COUNT(*) INTO n FROM user_tables WHERE table_name = 'WMS_AI_TRIAL';
    IF n = 0 THEN
        EXECUTE IMMEDIATE q'[
            CREATE TABLE wms_ai_trial (
                trial_start  DATE DEFAULT SYSDATE,
                trial_end    DATE NOT NULL,
                active       VARCHAR2(1) DEFAULT 'Y' NOT NULL CHECK (active IN ('Y','N')),
                message      VARCHAR2(1000),
                updated_by   VARCHAR2(120),
                updated_date DATE DEFAULT SYSDATE
            )]';
    END IF;
END;
/

-- 2. The one row: create a 30-day trial if there is none yet
INSERT INTO wms_ai_trial (trial_end, active, message)
SELECT TRUNC(SYSDATE) + 30 + (23/24 + 59/1440), 'Y',
       'The AI Digital Employee and Fusion SQL trial has ended. Please contact the administrator to continue using them.'
FROM dual
WHERE NOT EXISTS (SELECT 1 FROM wms_ai_trial);
COMMIT;

-- 3. Check the current trial (same query the modules run)
SELECT TO_CHAR(trial_end, 'YYYY-MM-DD HH24:MI') AS trial_end, active,
       GREATEST(TRUNC(trial_end) - TRUNC(SYSDATE), 0) AS days_left,
       CASE WHEN SYSDATE > trial_end THEN 'Y' ELSE 'N' END AS expired
FROM wms_ai_trial WHERE ROWNUM = 1;

-- ── Admin snippets (run one as needed) ─────────────────────────
-- Extend the trial for both modules to a date:
--   UPDATE wms_ai_trial SET trial_end = TO_DATE('2026-10-31 23:59', 'YYYY-MM-DD HH24:MI'), active = 'Y'; COMMIT;
-- Add 15 more days:
--   UPDATE wms_ai_trial SET trial_end = GREATEST(trial_end, SYSDATE) + 15, active = 'Y'; COMMIT;
-- End the trial now (locks both modules):
--   UPDATE wms_ai_trial SET trial_end = SYSDATE - 1/1440, active = 'Y'; COMMIT;
-- Lock-screen text shown by both modules:
--   UPDATE wms_ai_trial SET message = 'The AI Digital Employee and Fusion SQL trial has ended. Please contact the administrator.'; COMMIT;
-- Licensed - switch the gate off for both modules:
--   UPDATE wms_ai_trial SET active = 'N'; COMMIT;
