-- ============================================================
-- WMS AI CHAT - SUPPORT TABLES (Phase P1)
-- ============================================================
-- Prerequisite for 35b_ai_rest_handlers.sql
-- Run in APEX SQL Workshop > SQL Commands (or SQL Developer)
-- ============================================================
-- Creates:
--   WMS_AI_OBJECT_ACL   - optional allow/deny list for metadata endpoint
--   WMS_AI_QUERY_LOG    - audit of every /query call (R-4.2.8)
--   WMS_AI_LOG_QUERY    - autonomous logging procedure
-- Plus a starter COMMENT ON pass for the main WMS objects
-- (comments are the only semantics the AI model gets - R-4.1.3)
-- ============================================================


-- ============================================================
-- 1. OBJECT ACL (R-4.1.2)
-- ============================================================
-- Default behaviour with NO rows: every table/view is exposed.
-- Insert allowed_flag='N' rows to hide specific objects, or
-- insert only 'Y' rows to switch to whitelist mode
-- (when at least one 'Y' row exists, ONLY 'Y' objects are returned).
-- ============================================================
CREATE TABLE wms_ai_object_acl (
    object_name   VARCHAR2(128) NOT NULL,
    allowed_flag  CHAR(1) DEFAULT 'Y' NOT NULL CHECK (allowed_flag IN ('Y','N')),
    notes         VARCHAR2(500),
    created_date  DATE DEFAULT SYSDATE,
    CONSTRAINT wms_ai_object_acl_pk PRIMARY KEY (object_name)
);

COMMENT ON TABLE  wms_ai_object_acl IS 'Governance for the AI metadata endpoint: which tables/views the AI assistant may see. Empty table = everything visible.';
COMMENT ON COLUMN wms_ai_object_acl.object_name  IS 'Table or view name (UPPERCASE)';
COMMENT ON COLUMN wms_ai_object_acl.allowed_flag IS 'Y = whitelisted, N = always hidden';

-- Recommended: always hide the AI plumbing tables themselves
INSERT INTO wms_ai_object_acl (object_name, allowed_flag, notes) VALUES ('WMS_AI_QUERY_LOG',  'N', 'AI plumbing - hide from model');
INSERT INTO wms_ai_object_acl (object_name, allowed_flag, notes) VALUES ('WMS_AI_OBJECT_ACL', 'N', 'AI plumbing - hide from model');
COMMIT;


-- ============================================================
-- 2. QUERY AUDIT LOG (R-4.2.8)
-- ============================================================
CREATE TABLE wms_ai_query_log (
    log_id        NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at    TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    app_user      VARCHAR2(100),
    sql_text      CLOB,
    row_count     NUMBER,
    elapsed_ms    NUMBER,
    success_flag  CHAR(1) CHECK (success_flag IN ('Y','N')),
    error_text    VARCHAR2(4000)
);

COMMENT ON TABLE wms_ai_query_log IS 'Audit of every SQL statement submitted to the AI query endpoint, successful or rejected.';


-- ============================================================
-- 3. AUTONOMOUS LOGGING PROCEDURE
-- ============================================================
-- Autonomous so the audit row survives even when the handler
-- raises / rolls back.
-- ============================================================
CREATE OR REPLACE PROCEDURE wms_ai_log_query (
    p_app_user   IN VARCHAR2,
    p_sql_text   IN CLOB,
    p_row_count  IN NUMBER,
    p_elapsed_ms IN NUMBER,
    p_success    IN CHAR,      -- 'Y' / 'N'
    p_error      IN VARCHAR2
) IS
    PRAGMA AUTONOMOUS_TRANSACTION;
BEGIN
    INSERT INTO wms_ai_query_log (app_user, sql_text, row_count, elapsed_ms, success_flag, error_text)
    VALUES (p_app_user, p_sql_text, p_row_count, p_elapsed_ms, p_success, SUBSTR(p_error, 1, 4000));
    COMMIT;
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;  -- never let logging break the handler
END wms_ai_log_query;
/


-- ============================================================
-- 4. STARTER COMMENT PASS (R-4.1.3)
-- ============================================================
-- Comments below are a starting point - extend/correct them.
-- The AI model sees these verbatim; the better the comments,
-- the better its SQL.
-- ============================================================
COMMENT ON TABLE wms_trip_config                     IS 'Delivery trips: one row per trip with lorry, loading bay, priority, date and status';
COMMENT ON TABLE wms_printer_config                  IS 'Configured printers per workstation: name, type, connection settings';
COMMENT ON TABLE wms_print_jobs                      IS 'Print job queue: one row per document sent to a printer, with status';
COMMENT ON TABLE wms_print_job_history               IS 'Completed/failed print jobs history';
COMMENT ON TABLE wms_monitor_printing                IS 'Monitor-printing configuration: trips being watched for automatic printing';
COMMENT ON TABLE wms_order_shipment_lines            IS 'Shipment lines per sales order synced from Oracle Fusion (statuses: Ready to Release, Released to Warehouse, Staged, Interfaced, Cancelled)';
COMMENT ON TABLE wms_agents_config                   IS 'Shipping agents: autonomous monitors that check shipment lines, cancel stuck lines and auto-print interfaced orders';
COMMENT ON TABLE wms_agents_trips                    IS 'Trips assigned to each shipping agent';
COMMENT ON TABLE wms_agents_activity_log             IS 'Every action taken by a shipping agent (CHECK_STATUS, CANCEL_LINE, AUTO_PRINT...)';
COMMENT ON TABLE wms_agents_notifications            IS 'Notifications raised by shipping agents (anomalies, warnings)';
COMMENT ON TABLE wms_agents_performance              IS 'Per-day performance counters for each shipping agent';
COMMENT ON TABLE wms_shiping_agents_orders_status    IS 'Latest order-level status snapshot per trip captured by shipping agents';


-- ============================================================
-- VERIFY
-- ============================================================
-- SELECT * FROM wms_ai_object_acl;
-- SELECT * FROM wms_ai_query_log ORDER BY log_id DESC;
-- BEGIN wms_ai_log_query('TEST', 'SELECT 1 FROM dual', 1, 5, 'Y', NULL); END;
-- /
