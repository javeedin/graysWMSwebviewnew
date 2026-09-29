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
-- 2. LOCAL job leases (see section 2 below).
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
