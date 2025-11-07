-- ============================================================================
-- CHECK WHAT PROCEDURES YOU HAVE
-- ============================================================================

-- 1. Check all monitor printing procedures
SELECT
    object_name,
    object_type,
    status,
    TO_CHAR(created, 'YYYY-MM-DD HH24:MI:SS') as created_date,
    TO_CHAR(last_ddl_time, 'YYYY-MM-DD HH24:MI:SS') as last_modified
FROM user_objects
WHERE object_name LIKE 'WMS_%MONITOR%'
ORDER BY object_name;

-- ============================================================================
-- EXPECTED RESULTS:
-- ============================================================================
-- You should see these procedures:
-- 1. WMS_ENABLE_MONITOR_PRINTING_V2    (NEW - handles orders)
-- 2. WMS_GET_ORDER_DETAILS             (NEW - gets orders)
-- 3. WMS_UPDATE_ORDER_STATUS           (NEW - updates order)
-- 4. WMS_ENABLE_MONITOR_PRINTING       (OLD - no orders support)
-- 5. WMS_DISABLE_MONITOR_PRINTING      (OLD)
-- 6. WMS_GET_MONITOR_PRINTING_LIST     (OLD)
-- ============================================================================

-- 2. Check parameters for V2 procedure
SELECT
    object_name,
    procedure_name,
    argument_name,
    position,
    data_type,
    in_out
FROM user_arguments
WHERE object_name = 'WMS_ENABLE_MONITOR_PRINTING_V2'
ORDER BY position;

-- ============================================================================
-- EXPECTED RESULTS:
-- ============================================================================
-- Position 1: P_TRIP_ID (IN VARCHAR2)
-- Position 2: P_TRIP_DATE (IN VARCHAR2)
-- Position 3: P_ORDER_COUNT (IN NUMBER)
-- Position 4: P_PRINTER_CONFIG_ID (IN NUMBER)
-- Position 5: P_PRINTER_NAME (IN VARCHAR2)
-- Position 6: P_ORDERS_JSON (IN CLOB)          ← KEY: This accepts orders!
-- Position 7: P_RESULT (OUT VARCHAR2)
-- Position 8: P_MONITOR_ID (OUT NUMBER)
-- ============================================================================

-- 3. Check if tables exist
SELECT table_name, num_rows, TO_CHAR(last_analyzed, 'YYYY-MM-DD HH24:MI:SS') as last_analyzed
FROM user_tables
WHERE table_name IN ('WMS_MONITOR_PRINTING', 'WMS_MONITOR_PRINTING_DETAILS')
ORDER BY table_name;

-- ============================================================================
-- EXPECTED RESULTS:
-- ============================================================================
-- WMS_MONITOR_PRINTING         (trip-level data)
-- WMS_MONITOR_PRINTING_DETAILS (order-level data) ← Must exist!
-- ============================================================================

-- 4. Check if V2 procedure is VALID
SELECT object_name, object_type, status
FROM user_objects
WHERE object_name = 'WMS_ENABLE_MONITOR_PRINTING_V2';

-- ============================================================================
-- IF STATUS = 'INVALID':
-- ============================================================================
-- The procedure has compilation errors. To see errors, run:
-- SELECT * FROM user_errors WHERE name = 'WMS_ENABLE_MONITOR_PRINTING_V2';
-- ============================================================================

-- 5. Show procedure source code (first 50 lines)
SELECT text
FROM user_source
WHERE name = 'WMS_ENABLE_MONITOR_PRINTING_V2'
AND type = 'PROCEDURE'
AND line <= 50
ORDER BY line;

-- ============================================================================
-- WHAT TO DO BASED ON RESULTS:
-- ============================================================================

-- SCENARIO 1: V2 procedure doesn't exist
-- → Run: 09_monitor_printing_details.sql (creates V2 procedure)

-- SCENARIO 2: V2 procedure exists but STATUS = INVALID
-- → Check errors with: SELECT * FROM user_errors WHERE name = 'WMS_ENABLE_MONITOR_PRINTING_V2';
-- → Fix errors and recompile

-- SCENARIO 3: V2 procedure exists and STATUS = VALID
-- → Good! Update your POST /monitor-printing/enable endpoint to use V2

-- SCENARIO 4: Table WMS_MONITOR_PRINTING_DETAILS doesn't exist
-- → Run: 09_monitor_printing_details.sql (creates table + procedures)

-- ============================================================================
-- END OF FILE
-- ============================================================================
