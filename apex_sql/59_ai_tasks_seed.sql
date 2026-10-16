-- ============================================================
-- 59 — SEED the Daily Tasks list with the common WMS tasks
-- ============================================================
-- Inserts the standard "Task Library" tasks straight into wms_ai_tasks so
-- they appear on the Daily Tasks board immediately. They are created for
-- TODAY as DAILY tasks (so they also roll forward each day) with status OPEN,
-- assigned to the AI Digital Employee.
--
-- Requires: apex_sql/57_ai_tasks.sql (tables). 58 is optional (executable cols).
-- Idempotent: each INSERT is skipped if a task with the same title already
-- exists for today, so you can re-run this safely.
--
-- Adjust the instance ('PROD') below if you want them seeded for TEST instead,
-- or duplicate the block for both.
-- ============================================================

-- Trips ------------------------------------------------------
INSERT INTO wms_ai_tasks (title, description, assignee, category, priority, task_date, recurrence, status, instance, created_by, created_date)
SELECT 'Cancel stuck Scheduled / Manual Reservation lines',
       'Find open trips whose order lines are Scheduled or Manual Reservation Required and cancel them (with child lines), then report how many.',
       'AI Digital Employee', 'Trips', 1, TRUNC(SYSDATE), 'DAILY', 'OPEN', 'PROD', 'LIBRARY-SEED', SYSDATE FROM dual
WHERE NOT EXISTS (SELECT 1 FROM wms_ai_tasks WHERE title = 'Cancel stuck Scheduled / Manual Reservation lines' AND task_date = TRUNC(SYSDATE));

INSERT INTO wms_ai_tasks (title, description, assignee, category, priority, task_date, recurrence, status, instance, created_by, created_date)
SELECT 'Morning trip status sweep',
       'Review every open trip and summarise status, pending picks, and any anomalies.',
       'AI Digital Employee', 'Trips', 2, TRUNC(SYSDATE), 'DAILY', 'OPEN', 'PROD', 'LIBRARY-SEED', SYSDATE FROM dual
WHERE NOT EXISTS (SELECT 1 FROM wms_ai_tasks WHERE title = 'Morning trip status sweep' AND task_date = TRUNC(SYSDATE));

INSERT INTO wms_ai_tasks (title, description, assignee, category, priority, task_date, recurrence, status, instance, created_by, created_date)
SELECT 'Close completed trips',
       'Find trips whose orders are all Interfaced or Shipped and mark/close them.',
       'AI Digital Employee', 'Trips', 3, TRUNC(SYSDATE), 'DAILY', 'OPEN', 'PROD', 'LIBRARY-SEED', SYSDATE FROM dual
WHERE NOT EXISTS (SELECT 1 FROM wms_ai_tasks WHERE title = 'Close completed trips' AND task_date = TRUNC(SYSDATE));

-- Picking ----------------------------------------------------
INSERT INTO wms_ai_tasks (title, description, assignee, category, priority, task_date, recurrence, status, instance, created_by, created_date)
SELECT 'Release picks for ready orders',
       'Release picks for orders that are ready to pick on active trips.',
       'AI Digital Employee', 'Picking', 2, TRUNC(SYSDATE), 'ONCE', 'OPEN', 'PROD', 'LIBRARY-SEED', SYSDATE FROM dual
WHERE NOT EXISTS (SELECT 1 FROM wms_ai_tasks WHERE title = 'Release picks for ready orders' AND task_date = TRUNC(SYSDATE));

INSERT INTO wms_ai_tasks (title, description, assignee, category, priority, task_date, recurrence, status, instance, created_by, created_date)
SELECT 'Picker workload summary',
       'Show each picker assigned vs completed orders for today.',
       'AI Digital Employee', 'Picking', 3, TRUNC(SYSDATE), 'DAILY', 'OPEN', 'PROD', 'LIBRARY-SEED', SYSDATE FROM dual
WHERE NOT EXISTS (SELECT 1 FROM wms_ai_tasks WHERE title = 'Picker workload summary' AND task_date = TRUNC(SYSDATE));

-- Printing ---------------------------------------------------
INSERT INTO wms_ai_tasks (title, description, assignee, category, priority, task_date, recurrence, status, instance, created_by, created_date)
SELECT 'Auto-print interfaced orders',
       'Print all newly Interfaced orders for today trips that have not been printed yet.',
       'AI Digital Employee', 'Printing', 2, TRUNC(SYSDATE), 'DAILY', 'OPEN', 'PROD', 'LIBRARY-SEED', SYSDATE FROM dual
WHERE NOT EXISTS (SELECT 1 FROM wms_ai_tasks WHERE title = 'Auto-print interfaced orders' AND task_date = TRUNC(SYSDATE));

INSERT INTO wms_ai_tasks (title, description, assignee, category, priority, task_date, recurrence, status, instance, created_by, created_date)
SELECT 'Retry failed print jobs',
       'List print jobs that failed in the last 24 hours and retry them, then report.',
       'AI Digital Employee', 'Printing', 2, TRUNC(SYSDATE), 'DAILY', 'OPEN', 'PROD', 'LIBRARY-SEED', SYSDATE FROM dual
WHERE NOT EXISTS (SELECT 1 FROM wms_ai_tasks WHERE title = 'Retry failed print jobs' AND task_date = TRUNC(SYSDATE));

-- Orders -----------------------------------------------------
INSERT INTO wms_ai_tasks (title, description, assignee, category, priority, task_date, recurrence, status, instance, created_by, created_date)
SELECT 'Orders with cancelled shipment lines',
       'List today orders that have cancelled shipment lines and the reasons.',
       'AI Digital Employee', 'Orders', 3, TRUNC(SYSDATE), 'DAILY', 'OPEN', 'PROD', 'LIBRARY-SEED', SYSDATE FROM dual
WHERE NOT EXISTS (SELECT 1 FROM wms_ai_tasks WHERE title = 'Orders with cancelled shipment lines' AND task_date = TRUNC(SYSDATE));

INSERT INTO wms_ai_tasks (title, description, assignee, category, priority, task_date, recurrence, status, instance, created_by, created_date)
SELECT 'Backordered / short-picked report',
       'Report orders that are backordered or short-picked and need attention.',
       'AI Digital Employee', 'Orders', 2, TRUNC(SYSDATE), 'DAILY', 'OPEN', 'PROD', 'LIBRARY-SEED', SYSDATE FROM dual
WHERE NOT EXISTS (SELECT 1 FROM wms_ai_tasks WHERE title = 'Backordered / short-picked report' AND task_date = TRUNC(SYSDATE));

-- Store / S2V ------------------------------------------------
INSERT INTO wms_ai_tasks (title, description, assignee, category, priority, task_date, recurrence, status, instance, created_by, created_date)
SELECT 'Process pending store-to-van transfers',
       'Find pending S2V transactions for today and process/report them.',
       'AI Digital Employee', 'Store / S2V', 2, TRUNC(SYSDATE), 'DAILY', 'OPEN', 'PROD', 'LIBRARY-SEED', SYSDATE FROM dual
WHERE NOT EXISTS (SELECT 1 FROM wms_ai_tasks WHERE title = 'Process pending store-to-van transfers' AND task_date = TRUNC(SYSDATE));

-- Inventory --------------------------------------------------
INSERT INTO wms_ai_tasks (title, description, assignee, category, priority, task_date, recurrence, status, instance, created_by, created_date)
SELECT 'Low / negative on-hand check',
       'Report items with low or negative on-hand that could block fulfilment.',
       'AI Digital Employee', 'Inventory', 2, TRUNC(SYSDATE), 'DAILY', 'OPEN', 'PROD', 'LIBRARY-SEED', SYSDATE FROM dual
WHERE NOT EXISTS (SELECT 1 FROM wms_ai_tasks WHERE title = 'Low / negative on-hand check' AND task_date = TRUNC(SYSDATE));

-- Monitoring -------------------------------------------------
INSERT INTO wms_ai_tasks (title, description, assignee, category, priority, task_date, recurrence, status, instance, created_by, created_date)
SELECT 'Shipping agent activity (24h)',
       'Summarise what the shipping agent did in the last 24 hours (cancels, prints, errors).',
       'AI Digital Employee', 'Monitoring', 3, TRUNC(SYSDATE), 'DAILY', 'OPEN', 'PROD', 'LIBRARY-SEED', SYSDATE FROM dual
WHERE NOT EXISTS (SELECT 1 FROM wms_ai_tasks WHERE title = 'Shipping agent activity (24h)' AND task_date = TRUNC(SYSDATE));

INSERT INTO wms_ai_tasks (title, description, assignee, category, priority, task_date, recurrence, status, instance, created_by, created_date)
SELECT 'Failed API calls review',
       'Review WMS_AI_API_LOG for failed calls in the last 24 hours and report patterns.',
       'AI Digital Employee', 'Monitoring', 3, TRUNC(SYSDATE), 'DAILY', 'OPEN', 'PROD', 'LIBRARY-SEED', SYSDATE FROM dual
WHERE NOT EXISTS (SELECT 1 FROM wms_ai_tasks WHERE title = 'Failed API calls review' AND task_date = TRUNC(SYSDATE));

COMMIT;

-- Verify:  SELECT task_id, category, title, status FROM wms_ai_tasks WHERE created_by = 'LIBRARY-SEED' ORDER BY category, priority;
