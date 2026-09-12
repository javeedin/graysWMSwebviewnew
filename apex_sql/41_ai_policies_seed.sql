-- ============================================================
-- AI DIGITAL EMPLOYEE - RECOMMENDED POLICY SET (full list)
-- ============================================================
-- Prerequisite: 40_ai_policies.sql (table + ai/policies handler).
--
-- Philosophy:
--   TEST  = training ground: the employee acts freely on routine
--           operations, still asks for anything persistent/risky.
--   PROD  = supervised: everything asks, destructive DDL/DML denied
--           for regular users; the admin gets limited autonomy.
--
-- Uses MERGE, so it is safe to re-run and it OVERRIDES the plain
-- ASK seeds from script 40. Replace ADMIN_USER below with the real
-- Windows username of the administrator (check with:
--   SELECT DISTINCT invoked_by FROM wms_ai_api_log;  or the
--   created_by values in wms_ai_jobs).
-- ============================================================

-- ADMIN USER: replace the literal 'JAVEED' in the two ADMIN rows at the
-- bottom with the real Windows username (as Environment.UserName reports
-- it). APEX SQL Workshop does not support DEFINE substitution variables.

-- ------------------------------------------------------------
-- Helper: one MERGE per rule
-- ------------------------------------------------------------

-- ══════════ EVERYONE ('*') on TEST — liberal ══════════

-- Fusion writes (line cancels incl. child lines, ship confirms):
-- AUTO up to 20 lines per call; bigger batches still ask.
MERGE INTO wms_ai_policies p
USING (SELECT '*' u, 'fusion_write' a, 'TEST' i FROM dual) s
ON (p.app_user = s.u AND p.action_key = s.a AND p.instance = s.i)
WHEN MATCHED THEN UPDATE SET mode = 'AUTO', max_batch = 20, note = 'TEST: act freely, ask above 20 lines', updated_by = 'SEED41', updated_date = SYSDATE
WHEN NOT MATCHED THEN INSERT (app_user, action_key, instance, mode, max_batch, note, updated_by)
VALUES ('*', 'fusion_write', 'TEST', 'AUTO', 20, 'TEST: act freely, ask above 20 lines', 'SEED41');

-- WMS write APIs (create trip, add orders, assign picker, pick
-- wave/release, cancellations): AUTO on TEST - forms run without
-- the confirm dialog, still fully logged.
MERGE INTO wms_ai_policies p
USING (SELECT '*' u, 'wms_api' a, 'TEST' i FROM dual) s
ON (p.app_user = s.u AND p.action_key = s.a AND p.instance = s.i)
WHEN MATCHED THEN UPDATE SET mode = 'AUTO', max_batch = NULL, note = 'TEST: forms run without confirm dialog', updated_by = 'SEED41', updated_date = SYSDATE
WHEN NOT MATCHED THEN INSERT (app_user, action_key, instance, mode, note, updated_by)
VALUES ('*', 'wms_api', 'TEST', 'AUTO', 'TEST: forms run without confirm dialog', 'SEED41');

-- DDL/DML from chat: AUTO on TEST (sandbox), so table experiments
-- flow freely. Change to ASK if TEST data matters to you.
MERGE INTO wms_ai_policies p
USING (SELECT '*' u, 'db_write' a, 'TEST' i FROM dual) s
ON (p.app_user = s.u AND p.action_key = s.a AND p.instance = s.i)
WHEN MATCHED THEN UPDATE SET mode = 'AUTO', max_batch = NULL, note = 'TEST sandbox: DDL/DML without card', updated_by = 'SEED41', updated_date = SYSDATE
WHEN NOT MATCHED THEN INSERT (app_user, action_key, instance, mode, note, updated_by)
VALUES ('*', 'db_write', 'TEST', 'AUTO', 'TEST sandbox: DDL/DML without card', 'SEED41');

-- Scheduled jobs: ASK even on TEST - jobs persist and keep running
-- after the chat ends, so a human look is worth it.
MERGE INTO wms_ai_policies p
USING (SELECT '*' u, 'schedule_job' a, 'TEST' i FROM dual) s
ON (p.app_user = s.u AND p.action_key = s.a AND p.instance = s.i)
WHEN MATCHED THEN UPDATE SET mode = 'ASK', max_batch = NULL, note = 'jobs persist - always review the plan', updated_by = 'SEED41', updated_date = SYSDATE
WHEN NOT MATCHED THEN INSERT (app_user, action_key, instance, mode, note, updated_by)
VALUES ('*', 'schedule_job', 'TEST', 'ASK', 'jobs persist - always review the plan', 'SEED41');

-- ══════════ EVERYONE ('*') on PROD — supervised ══════════

-- Fusion writes: always ask on PROD.
MERGE INTO wms_ai_policies p
USING (SELECT '*' u, 'fusion_write' a, 'PROD' i FROM dual) s
ON (p.app_user = s.u AND p.action_key = s.a AND p.instance = s.i)
WHEN MATCHED THEN UPDATE SET mode = 'ASK', max_batch = NULL, note = 'PROD: human approves every write', updated_by = 'SEED41', updated_date = SYSDATE
WHEN NOT MATCHED THEN INSERT (app_user, action_key, instance, mode, note, updated_by)
VALUES ('*', 'fusion_write', 'PROD', 'ASK', 'PROD: human approves every write', 'SEED41');

-- WMS write APIs: always ask on PROD.
MERGE INTO wms_ai_policies p
USING (SELECT '*' u, 'wms_api' a, 'PROD' i FROM dual) s
ON (p.app_user = s.u AND p.action_key = s.a AND p.instance = s.i)
WHEN MATCHED THEN UPDATE SET mode = 'ASK', max_batch = NULL, note = 'PROD: confirm dialog on every form', updated_by = 'SEED41', updated_date = SYSDATE
WHEN NOT MATCHED THEN INSERT (app_user, action_key, instance, mode, note, updated_by)
VALUES ('*', 'wms_api', 'PROD', 'ASK', 'PROD: confirm dialog on every form', 'SEED41');

-- DDL/DML on PROD: DENIED for regular users - only the admin row
-- below can do it (with a card).
MERGE INTO wms_ai_policies p
USING (SELECT '*' u, 'db_write' a, 'PROD' i FROM dual) s
ON (p.app_user = s.u AND p.action_key = s.a AND p.instance = s.i)
WHEN MATCHED THEN UPDATE SET mode = 'DENY', max_batch = NULL, note = 'PROD schema changes: admin only', updated_by = 'SEED41', updated_date = SYSDATE
WHEN NOT MATCHED THEN INSERT (app_user, action_key, instance, mode, note, updated_by)
VALUES ('*', 'db_write', 'PROD', 'DENY', 'PROD schema changes: admin only', 'SEED41');

-- Scheduled jobs on PROD: ask.
MERGE INTO wms_ai_policies p
USING (SELECT '*' u, 'schedule_job' a, 'PROD' i FROM dual) s
ON (p.app_user = s.u AND p.action_key = s.a AND p.instance = s.i)
WHEN MATCHED THEN UPDATE SET mode = 'ASK', max_batch = NULL, note = 'PROD: review every job plan', updated_by = 'SEED41', updated_date = SYSDATE
WHEN NOT MATCHED THEN INSERT (app_user, action_key, instance, mode, note, updated_by)
VALUES ('*', 'schedule_job', 'PROD', 'ASK', 'PROD: review every job plan', 'SEED41');

-- ══════════ EVERYONE ('*'), BOTH instances ══════════
-- (v1: AUTO not yet supported for these three - ASK is the ceiling;
--  rows kept explicit so DENY can be applied per user if needed)

MERGE INTO wms_ai_policies p
USING (SELECT '*' u, 'email' a, '*' i FROM dual) s
ON (p.app_user = s.u AND p.action_key = s.a AND p.instance = s.i)
WHEN MATCHED THEN UPDATE SET mode = 'ASK', max_batch = NULL, note = 'review recipients + body before send', updated_by = 'SEED41', updated_date = SYSDATE
WHEN NOT MATCHED THEN INSERT (app_user, action_key, instance, mode, note, updated_by)
VALUES ('*', 'email', '*', 'ASK', 'review recipients + body before send', 'SEED41');

MERGE INTO wms_ai_policies p
USING (SELECT '*' u, 'print' a, '*' i FROM dual) s
ON (p.app_user = s.u AND p.action_key = s.a AND p.instance = s.i)
WHEN MATCHED THEN UPDATE SET mode = 'ASK', max_batch = NULL, note = 'physical output - confirm', updated_by = 'SEED41', updated_date = SYSDATE
WHEN NOT MATCHED THEN INSERT (app_user, action_key, instance, mode, note, updated_by)
VALUES ('*', 'print', '*', 'ASK', 'physical output - confirm', 'SEED41');

MERGE INTO wms_ai_policies p
USING (SELECT '*' u, 'print_orders' a, '*' i FROM dual) s
ON (p.app_user = s.u AND p.action_key = s.a AND p.instance = s.i)
WHEN MATCHED THEN UPDATE SET mode = 'ASK', max_batch = NULL, note = 'paper + toner - confirm the batch', updated_by = 'SEED41', updated_date = SYSDATE
WHEN NOT MATCHED THEN INSERT (app_user, action_key, instance, mode, note, updated_by)
VALUES ('*', 'print_orders', '*', 'ASK', 'paper + toner - confirm the batch', 'SEED41');

-- ══════════ ADMIN on PROD — limited autonomy ══════════

-- Admin may auto-cancel small batches on PROD (max 5 lines);
-- bigger sets fall back to the approval card.
MERGE INTO wms_ai_policies p
USING (SELECT UPPER('JAVEED') u, 'fusion_write' a, 'PROD' i FROM dual) s
ON (p.app_user = s.u AND p.action_key = s.a AND p.instance = s.i)
WHEN MATCHED THEN UPDATE SET mode = 'AUTO', max_batch = 5, note = 'admin: small PROD cancels unaided', updated_by = 'SEED41', updated_date = SYSDATE
WHEN NOT MATCHED THEN INSERT (app_user, action_key, instance, mode, max_batch, note, updated_by)
VALUES (UPPER('JAVEED'), 'fusion_write', 'PROD', 'AUTO', 5, 'admin: small PROD cancels unaided', 'SEED41');

-- Admin may run DDL/DML on PROD - but always with a card.
MERGE INTO wms_ai_policies p
USING (SELECT UPPER('JAVEED') u, 'db_write' a, 'PROD' i FROM dual) s
ON (p.app_user = s.u AND p.action_key = s.a AND p.instance = s.i)
WHEN MATCHED THEN UPDATE SET mode = 'ASK', max_batch = NULL, note = 'admin: PROD DDL/DML allowed, with card', updated_by = 'SEED41', updated_date = SYSDATE
WHEN NOT MATCHED THEN INSERT (app_user, action_key, instance, mode, note, updated_by)
VALUES (UPPER('JAVEED'), 'db_write', 'PROD', 'ASK', 'admin: PROD DDL/DML allowed, with card', 'SEED41');

COMMIT;

-- ------------------------------------------------------------
-- Verify: effective policy matrix
-- ------------------------------------------------------------
SELECT app_user, action_key, instance, mode, max_batch, note
FROM wms_ai_policies
ORDER BY CASE app_user WHEN '*' THEN 1 ELSE 0 END, app_user, action_key,
         CASE instance WHEN '*' THEN 2 WHEN 'PROD' THEN 1 ELSE 0 END;
