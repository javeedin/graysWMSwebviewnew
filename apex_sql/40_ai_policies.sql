-- ============================================================
-- AI DIGITAL EMPLOYEE - ACTION POLICIES (authority limits)
-- (column is POLICY_MODE - "MODE" is an Oracle reserved word)
-- ============================================================
-- Decides, per user and per action, whether the AI may act
-- WITHOUT asking (AUTO), must show an approval card (ASK - the
-- default and today's behavior), or may not act at all (DENY).
--
-- Resolution order (most specific wins):
--   1. app_user = <user>  AND instance = <PROD|TEST>
--   2. app_user = <user>  AND instance = '*'
--   3. app_user = '*'     AND instance = <PROD|TEST>
--   4. app_user = '*'     AND instance = '*'
--   default when nothing matches: ASK
--
-- action_key values enforced by the app:
--   fusion_write   Fusion POST/PATCH/DELETE (line cancels etc.)
--   db_write       DDL / DML from chat
--   schedule_job   creating DBMS scheduler jobs
--   wms_api        write-API forms (trips.create, addorders, ...)
--   print_orders   printing order PDF batches   (v1: AUTO treated as ASK)
--   print          printing the result grid     (v1: AUTO treated as ASK)
--   email          sending emails               (v1: AUTO treated as ASK)
--
-- max_batch (nullable): for fusion_write AUTO - if the request
-- carries more lines than max_batch, it is downgraded to ASK.
--
-- STEP 1: run the table + seed below.
-- STEP 2: create the REST handler at the bottom
--         (GET ai/policies with a declared 'appuser' URI param).
-- ============================================================

CREATE TABLE wms_ai_policies (
    policy_id    NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    app_user     VARCHAR2(100) DEFAULT '*' NOT NULL,   -- Windows username or '*'
    action_key   VARCHAR2(40) NOT NULL,
    instance     VARCHAR2(10) DEFAULT '*' NOT NULL CHECK (instance IN ('*','PROD','TEST')),
    policy_mode  VARCHAR2(10) NOT NULL CHECK (policy_mode IN ('AUTO','ASK','DENY')),
    max_batch    NUMBER,
    note         VARCHAR2(400),
    updated_by   VARCHAR2(100),
    updated_date DATE DEFAULT SYSDATE,
    CONSTRAINT wms_ai_policies_uq UNIQUE (app_user, action_key, instance)
);

COMMENT ON TABLE wms_ai_policies IS 'AI Digital Employee authority limits: per user/action/instance -> AUTO (act without asking), ASK (approval card), DENY (refused). Missing = ASK.';

-- Seed: everything ASK everywhere (today's behavior, explicit)
INSERT INTO wms_ai_policies (app_user, action_key, instance, policy_mode, note)
    SELECT '*', k, '*', 'ASK', 'default'
    FROM (SELECT 'fusion_write' k FROM dual UNION ALL SELECT 'db_write' FROM dual
          UNION ALL SELECT 'schedule_job' FROM dual UNION ALL SELECT 'wms_api' FROM dual
          UNION ALL SELECT 'print_orders' FROM dual UNION ALL SELECT 'print' FROM dual
          UNION ALL SELECT 'email' FROM dual);
COMMIT;

-- Examples (edit to taste):
-- Everything AUTO on TEST for everyone:
--   UPDATE wms_ai_policies SET policy_mode='AUTO' WHERE app_user='*' AND instance='*' AND action_key IN ('fusion_write','wms_api');
--   ... or add instance-specific rows:
--   INSERT INTO wms_ai_policies (app_user, action_key, instance, policy_mode) VALUES ('*','fusion_write','TEST','AUTO');
-- One power user may auto-cancel up to 5 lines on PROD:
--   INSERT INTO wms_ai_policies (app_user, action_key, instance, policy_mode, max_batch) VALUES ('JAVEED','fusion_write','PROD','AUTO',5);
-- Block DDL/DML for everyone on PROD:
--   INSERT INTO wms_ai_policies (app_user, action_key, instance, policy_mode) VALUES ('*','db_write','PROD','DENY');


-- ============================================================
-- REST HANDLER: GET ai/policies        (?appuser=NAME)
-- ============================================================
-- Module:        WAREHOUSEMANAGEMENT
-- URI Template:  ai/policies
-- Method:        GET
-- Source Type:   PL/SQL
-- IMPORTANT:     add a handler Parameter:
--                Name=appuser, Bind Variable=appuser, Source Type=URI,
--                Access Method=IN, Data Type=STRING
-- ============================================================
BEGIN
    APEX_JSON.open_object;
    APEX_JSON.open_array('policies');
    FOR r IN (SELECT app_user, action_key, instance, policy_mode, max_batch
              FROM wms_ai_policies
              WHERE app_user = '*' OR UPPER(app_user) = UPPER(NVL(:appuser, '*'))
              ORDER BY policy_id) LOOP
        APEX_JSON.open_object;
        APEX_JSON.write('appUser',  r.app_user);
        APEX_JSON.write('action',   r.action_key);
        APEX_JSON.write('instance', r.instance);
        APEX_JSON.write('mode',     r.policy_mode);
        IF r.max_batch IS NOT NULL THEN APEX_JSON.write('maxBatch', r.max_batch); END IF;
        APEX_JSON.close_object;
    END LOOP;
    APEX_JSON.close_array;
    APEX_JSON.close_object;
END;
