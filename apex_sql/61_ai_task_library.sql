-- ============================================================
-- 61 — TASK LIBRARY (manageable templates)
-- ============================================================
-- The Task Library is now stored in the DB so you can add / edit / delete
-- reusable task templates from the app. Assigning a template creates a task
-- in wms_ai_tasks. Reads/writes go through ai/executequery + ai/executewrite
-- (no new ORDS handlers). Run once.
-- ============================================================
DECLARE
    v_n NUMBER;
BEGIN
    SELECT COUNT(*) INTO v_n FROM user_tables WHERE table_name = 'WMS_AI_TASK_LIBRARY';
    IF v_n = 0 THEN
        EXECUTE IMMEDIATE q'[
            CREATE TABLE wms_ai_task_library (
                lib_id       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                title        VARCHAR2(300) NOT NULL,
                description  CLOB,
                category     VARCHAR2(60),
                priority     NUMBER DEFAULT 2,
                recurrence   VARCHAR2(10) DEFAULT 'ONCE',
                action_json  CLOB,
                completion_sql CLOB,
                active       CHAR(1) DEFAULT 'Y',
                created_by   VARCHAR2(120),
                created_date DATE DEFAULT SYSDATE
            )
        ]';
    END IF;
END;
/

-- Seed the default templates (idempotent by title)
DECLARE
    PROCEDURE seed(p_title VARCHAR2, p_desc VARCHAR2, p_cat VARCHAR2, p_prio NUMBER, p_recur VARCHAR2) IS
        v_n NUMBER;
    BEGIN
        SELECT COUNT(*) INTO v_n FROM wms_ai_task_library WHERE title = p_title;
        IF v_n = 0 THEN
            INSERT INTO wms_ai_task_library (title, description, category, priority, recurrence, created_by)
            VALUES (p_title, p_desc, p_cat, p_prio, p_recur, 'SEED');
        END IF;
    END;
BEGIN
    seed('Cancel stuck Scheduled / Manual Reservation lines', 'Find open trips whose order lines are Scheduled or Manual Reservation Required and cancel them (with child lines), then report how many.', 'Trips', 1, 'DAILY');
    seed('Morning trip status sweep', 'Review every open trip and summarise status, pending picks, and any anomalies.', 'Trips', 2, 'DAILY');
    seed('Close completed trips', 'Find trips whose orders are all Interfaced or Shipped and mark/close them.', 'Trips', 3, 'DAILY');
    seed('Release picks for ready orders', 'Release picks for orders that are ready to pick on active trips.', 'Picking', 2, 'ONCE');
    seed('Picker workload summary', 'Show each picker assigned vs completed orders for today.', 'Picking', 3, 'DAILY');
    seed('Auto-print interfaced orders', 'Print all newly Interfaced orders for today trips that have not been printed yet.', 'Printing', 2, 'DAILY');
    seed('Retry failed print jobs', 'List print jobs that failed in the last 24 hours and retry them, then report.', 'Printing', 2, 'DAILY');
    seed('Orders with cancelled shipment lines', 'List today orders that have cancelled shipment lines and the reasons.', 'Orders', 3, 'DAILY');
    seed('Backordered / short-picked report', 'Report orders that are backordered or short-picked and need attention.', 'Orders', 2, 'DAILY');
    seed('Process pending store-to-van transfers', 'Find pending S2V transactions for today and process/report them.', 'Store / S2V', 2, 'DAILY');
    seed('Low / negative on-hand check', 'Report items with low or negative on-hand that could block fulfilment.', 'Inventory', 2, 'DAILY');
    seed('Shipping agent activity (24h)', 'Summarise what the shipping agent did in the last 24 hours (cancels, prints, errors).', 'Monitoring', 3, 'DAILY');
    seed('Failed API calls review', 'Review WMS_AI_API_LOG for failed calls in the last 24 hours and report patterns.', 'Monitoring', 3, 'DAILY');
    COMMIT;
END;
/
