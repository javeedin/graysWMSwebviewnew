-- ============================================================
-- WMS AGENTS - APEX REST HANDLERS
-- ============================================================
-- Module:        TRIPMANAGEMENT  (existing module)
-- Base Path:     Already configured in APEX
-- Run these in APEX SQL Workshop > RESTful Services
-- OR paste each block into the Handler Source in APEX UI
-- ============================================================
-- Prerequisite:  29_agents.sql must be executed first
-- ============================================================


-- ============================================================
-- HANDLER 1: POST  agents/create
-- ============================================================
-- Module:        TRIPMANAGEMENT
-- URI Template:  agents/create
-- Method:        POST
-- Source Type:   PL/SQL
-- ============================================================
-- Body JSON expected:
--   {
--     "name":                  "My Agent",
--     "description":           "Monitors overnight trips",
--     "instanceName":          "PROD",
--     "capabilities":          "MONITOR,PRINT,NOTIFY",
--     "checkIntervalSeconds":  60,
--     "maxRetries":            3,
--     "createdBy":             "ADMIN"
--   }
-- ============================================================
DECLARE
    v_body          CLOB;
    v_name          VARCHAR2(100);
    v_description   VARCHAR2(500);
    v_instance      VARCHAR2(20);
    v_capabilities  VARCHAR2(500);
    v_interval      NUMBER;
    v_max_retries   NUMBER;
    v_created_by    VARCHAR2(100);
    v_agent_id      NUMBER;
    v_result        VARCHAR2(200);
BEGIN
    v_body         := :body_text;
    APEX_JSON.parse(v_body);

    v_name         := APEX_JSON.get_varchar2('name');
    v_description  := APEX_JSON.get_varchar2('description');
    v_instance     := NVL(APEX_JSON.get_varchar2('instanceName'), 'PROD');
    v_capabilities := APEX_JSON.get_varchar2('capabilities');
    v_interval     := NVL(APEX_JSON.get_number('checkIntervalSeconds'), 60);
    v_max_retries  := NVL(APEX_JSON.get_number('maxRetries'), 3);
    v_created_by   := APEX_JSON.get_varchar2('createdBy');

    wms_agents_create(
        p_name         => v_name,
        p_description  => v_description,
        p_instance     => v_instance,
        p_capabilities => v_capabilities,
        p_interval     => v_interval,
        p_max_retries  => v_max_retries,
        p_created_by   => v_created_by,
        p_agent_id     => v_agent_id,
        p_result       => v_result
    );

    APEX_JSON.open_object;
    APEX_JSON.write('status',   v_result);
    APEX_JSON.write('agentId',  v_agent_id);
    APEX_JSON.close_object;
END;


-- ============================================================
-- HANDLER 2: GET  agents/list
-- ============================================================
-- Module:        TRIPMANAGEMENT
-- URI Template:  agents/list
-- Method:        GET
-- Source Type:   SQL Query
-- ============================================================
SELECT
    c.id                        AS id,
    c.name,
    c.description,
    c.instance_name,
    c.capabilities,
    c.status,
    c.agent_status,
    c.check_interval_seconds,
    c.max_retries,
    c.created_by,
    c.created_date,
    c.last_active_date,
    c.closed_date,
    c.total_trips_processed,
    c.total_actions_taken,
    -- Today's performance (may be NULL if agent has not run today)
    p.perf_date,
    NVL(p.status_checks,      0) AS status_checks,
    NVL(p.prints_triggered,   0) AS prints_triggered,
    NVL(p.pick_releases,      0) AS pick_releases,
    NVL(p.notifications_sent, 0) AS notifications_sent,
    NVL(p.anomalies_flagged,  0) AS anomalies_flagged,
    NVL(p.ai_calls,           0) AS ai_calls,
    NVL(p.retries_total,      0) AS retries_total,
    NVL(p.errors_total,       0) AS errors_total,
    p.first_activity_time,
    p.last_activity_time,
    NVL(p.active_duration_seconds, 0) AS active_duration_seconds,
    -- Active trip count
    (SELECT COUNT(*) FROM wms_agents_trips t
     WHERE t.agent_id = c.id AND t.status IN ('PENDING','ACTIVE')) AS trip_count,
    -- Actions today
    NVL(p.status_checks, 0) + NVL(p.prints_triggered, 0) + NVL(p.pick_releases, 0)
        + NVL(p.notifications_sent, 0) AS actions_today,
    NVL(p.anomalies_flagged, 0) AS anomalies_today
FROM wms_agents_config c
LEFT JOIN wms_agents_performance p
       ON p.agent_id  = c.id
      AND p.perf_date = TRUNC(SYSDATE)
WHERE (:FROM_DATE    IS NULL OR TRUNC(NVL(c.last_active_date, c.created_date)) >= TO_DATE(:FROM_DATE, 'YYYY-MM-DD'))
  AND (:TO_DATE      IS NULL OR TRUNC(NVL(c.last_active_date, c.created_date)) <= TO_DATE(:TO_DATE,   'YYYY-MM-DD'))
  AND (:AGENT_STATUS IS NULL OR c.agent_status = :AGENT_STATUS)
ORDER BY c.id DESC


-- ============================================================
-- HANDLER 2b: GET  agents/active
-- ============================================================
-- Module:        TRIPMANAGEMENT
-- URI Template:  agents/active
-- Method:        GET
-- Source Type:   SQL Query
-- Purpose:       Returns only ACTIVE agents for the trip-card
--                "Assign to Agent" dropdown (no date filter needed)
-- ============================================================
SELECT
    c.id          AS id,
    c.name,
    c.description,
    c.instance_name,
    c.capabilities,
    c.status,
    c.agent_status,
    (SELECT COUNT(*) FROM wms_agents_trips t
     WHERE t.agent_id = c.id AND t.status IN ('PENDING','ACTIVE')) AS trip_count
FROM wms_agents_config c
WHERE c.agent_status = 'ACTIVE'
ORDER BY c.id DESC


-- ============================================================
-- HANDLER 2c: GET  agents/:agentId/trips/:tripId/orders
-- ============================================================
-- Module:        TRIPMANAGEMENT
-- URI Template:  agents/:agentId/trips/:tripId/orders
-- Method:        GET
-- Source Type:   SQL Query
-- URI Binds:     :agentId (NUMBER), :tripId (VARCHAR2)
-- Query Param:   :P_INSTANCE_NAME
-- Purpose:       Returns all orders for a trip with aggregated
--                shipment line status, print status, and agent
--                assignment status.
-- ============================================================
SELECT
    sl.order_number,
    sl.instance_name,
    -- Shipment line counts by status
    COUNT(sl.id)                                                             AS total_lines,
    SUM(CASE WHEN UPPER(sl.line_status_code) = 'STAGED'      THEN 1 ELSE 0 END) AS staged_lines,
    SUM(CASE WHEN UPPER(sl.line_status_code) = 'CONFIRMED'   THEN 1 ELSE 0 END) AS confirmed_lines,
    SUM(CASE WHEN UPPER(sl.line_status_code) = 'SHIPPED'     THEN 1 ELSE 0 END) AS shipped_lines,
    SUM(CASE WHEN UPPER(sl.line_status_code) = 'CANCELLED'   THEN 1 ELSE 0 END) AS cancelled_lines,
    SUM(CASE WHEN UPPER(sl.line_status_code) = 'BACKORDERED' THEN 1 ELSE 0 END) AS backordered_lines,
    -- Dominant shipping status: highest priority non-zero status
    CASE
        WHEN SUM(CASE WHEN UPPER(sl.line_status_code) = 'SHIPPED'     THEN 1 ELSE 0 END) > 0
             AND SUM(CASE WHEN UPPER(sl.line_status_code) NOT IN ('SHIPPED','CANCELLED') THEN 1 ELSE 0 END) = 0
             THEN 'SHIPPED'
        WHEN SUM(CASE WHEN UPPER(sl.line_status_code) = 'CONFIRMED'   THEN 1 ELSE 0 END) > 0 THEN 'CONFIRMED'
        WHEN SUM(CASE WHEN UPPER(sl.line_status_code) = 'STAGED'      THEN 1 ELSE 0 END) > 0 THEN 'STAGED'
        WHEN SUM(CASE WHEN UPPER(sl.line_status_code) = 'BACKORDERED' THEN 1 ELSE 0 END) > 0 THEN 'BACKORDERED'
        WHEN SUM(CASE WHEN UPPER(sl.line_status_code) = 'CANCELLED'   THEN 1 ELSE 0 END) = COUNT(sl.id) THEN 'CANCELLED'
        ELSE 'PENDING'
    END AS shipping_status,
    -- Qty summary
    SUM(NVL(sl.requested_quantity, 0))                                       AS total_requested_qty,
    SUM(NVL(sl.shipped_quantity,   0))                                       AS total_shipped_qty,
    SUM(NVL(sl.staged_quantity,    0))                                       AS total_staged_qty,
    -- Print status from wms_print_jobs (if table exists)
    (SELECT COUNT(*) FROM wms_print_jobs pj
     WHERE pj.order_number = sl.order_number
       AND pj.instance_name = sl.instance_name)                              AS print_jobs_total,
    (SELECT COUNT(*) FROM wms_print_jobs pj
     WHERE pj.order_number = sl.order_number
       AND pj.instance_name = sl.instance_name
       AND UPPER(pj.print_status) = 'PRINTED')                              AS print_jobs_printed,
    -- Last update
    MAX(sl.wms_last_updated_date)                                            AS last_updated
FROM wms_order_shipment_lines sl
WHERE sl.instance_name = NVL(UPPER(:P_INSTANCE_NAME), 'PROD')
  AND sl.order_number IN (
      SELECT DISTINCT at2.order_number
      FROM   wms_agents_trips at1
      JOIN   wms_order_shipment_lines at2
             ON  at2.instance_name = NVL(UPPER(:P_INSTANCE_NAME), 'PROD')
      WHERE  at1.agent_id = :agentId
        AND  at1.trip_id  = :tripId
  )
GROUP BY sl.order_number, sl.instance_name
ORDER BY sl.order_number


-- ============================================================
-- HANDLER 3: PUT  agents/:agentId/status
-- ============================================================
-- Module:        TRIPMANAGEMENT
-- URI Template:  agents/:agentId/status
-- Method:        PUT
-- Source Type:   PL/SQL
-- URI Bind:      :agentId  (NUMBER)
-- ============================================================
-- Body JSON expected:
--   { "status": "RUNNING" }
-- ============================================================
DECLARE
    v_body      CLOB;
    v_status    VARCHAR2(20);
    v_result    VARCHAR2(200);
BEGIN
    v_body   := :body_text;
    APEX_JSON.parse(v_body);
    v_status := APEX_JSON.get_varchar2('status');

    wms_agents_update_status(
        p_agent_id => TO_NUMBER(:agentId),
        p_status   => v_status,
        p_result   => v_result
    );

    APEX_JSON.open_object;
    APEX_JSON.write('status',  v_result);
    APEX_JSON.write('agentId', TO_NUMBER(:agentId));
    APEX_JSON.close_object;
END;


-- ============================================================
-- HANDLER 4: POST  agents/:agentId/trips
-- ============================================================
-- Module:        TRIPMANAGEMENT
-- URI Template:  agents/:agentId/trips
-- Method:        POST
-- Source Type:   PL/SQL
-- URI Bind:      :agentId  (NUMBER)
-- ============================================================
-- Body JSON expected:
--   {
--     "tripId":       "TRIP-001",
--     "tripName":     "Overnight Run A",
--     "instanceName": "PROD"
--   }
-- ============================================================
DECLARE
    v_body      CLOB;
    v_trip_id   VARCHAR2(100);
    v_trip_name VARCHAR2(200);
    v_instance  VARCHAR2(20);
    v_result    VARCHAR2(200);
BEGIN
    v_body      := :body_text;
    APEX_JSON.parse(v_body);

    v_trip_id   := APEX_JSON.get_varchar2('tripId');
    v_trip_name := APEX_JSON.get_varchar2('tripName');
    v_instance  := NVL(APEX_JSON.get_varchar2('instanceName'), 'PROD');

    wms_agents_assign_trip(
        p_agent_id  => TO_NUMBER(:agentId),
        p_trip_id   => v_trip_id,
        p_trip_name => v_trip_name,
        p_instance  => v_instance,
        p_result    => v_result
    );

    APEX_JSON.open_object;
    APEX_JSON.write('status',  v_result);
    APEX_JSON.write('agentId', TO_NUMBER(:agentId));
    APEX_JSON.write('tripId',  v_trip_id);
    APEX_JSON.close_object;
END;


-- ============================================================
-- HANDLER 5: DELETE  agents/:agentId/trips/:tripId
-- ============================================================
-- Module:        TRIPMANAGEMENT
-- URI Template:  agents/:agentId/trips/:tripId
-- Method:        DELETE
-- Source Type:   PL/SQL
-- URI Binds:     :agentId (NUMBER), :tripId (VARCHAR2)
-- ============================================================
DECLARE
    v_result VARCHAR2(200);
BEGIN
    wms_agents_unassign_trip(
        p_agent_id => TO_NUMBER(:agentId),
        p_trip_id  => :tripId,
        p_result   => v_result
    );

    APEX_JSON.open_object;
    APEX_JSON.write('status',  v_result);
    APEX_JSON.write('agentId', TO_NUMBER(:agentId));
    APEX_JSON.write('tripId',  :tripId);
    APEX_JSON.close_object;
END;


-- ============================================================
-- HANDLER 6: GET  agents/:agentId/trips
-- ============================================================
-- Module:        TRIPMANAGEMENT
-- URI Template:  agents/:agentId/trips
-- Method:        GET
-- Source Type:   SQL Query
-- URI Bind:      :agentId  (NUMBER)
-- ============================================================
SELECT
    id,
    agent_id,
    trip_id,
    trip_name,
    instance_name,
    status,
    assigned_date,
    started_date,
    completed_date,
    orders_total,
    orders_processed,
    orders_printed,
    orders_stuck,
    anomalies_found,
    notes
FROM wms_agents_trips
WHERE agent_id = :agentId
ORDER BY assigned_date DESC


-- ============================================================
-- HANDLER 7: POST  agents/activity/log
-- ============================================================
-- Module:        TRIPMANAGEMENT
-- URI Template:  agents/activity/log
-- Method:        POST
-- Source Type:   PL/SQL
-- ============================================================
-- Body JSON expected:
--   {
--     "agentId":      1,
--     "tripId":       "TRIP-001",
--     "orderNumber":  "90105000006",
--     "activityType": "PRINT",
--     "status":       "SUCCESS",
--     "attempt":      1,
--     "message":      "Printed order PDF successfully",
--     "detailJson":   "{\"printer\":\"WH-PRINTER-01\"}",
--     "durationMs":   423
--   }
-- ============================================================
DECLARE
    v_body          CLOB;
    v_agent_id      NUMBER;
    v_trip_id       VARCHAR2(100);
    v_order_number  VARCHAR2(100);
    v_activity_type VARCHAR2(50);
    v_status        VARCHAR2(20);
    v_attempt       NUMBER;
    v_message       VARCHAR2(2000);
    v_detail_json   CLOB;
    v_duration_ms   NUMBER;
    v_result        VARCHAR2(200);
BEGIN
    v_body          := :body_text;
    APEX_JSON.parse(v_body);

    v_agent_id      := APEX_JSON.get_number('agentId');
    v_trip_id       := APEX_JSON.get_varchar2('tripId');
    v_order_number  := APEX_JSON.get_varchar2('orderNumber');
    v_activity_type := APEX_JSON.get_varchar2('activityType');
    v_status        := APEX_JSON.get_varchar2('status');
    v_attempt       := NVL(APEX_JSON.get_number('attempt'), 1);
    v_message       := APEX_JSON.get_varchar2('message');
    v_detail_json   := APEX_JSON.get_varchar2('detailJson');
    v_duration_ms   := APEX_JSON.get_number('durationMs');

    wms_agents_log_activity(
        p_agent_id      => v_agent_id,
        p_trip_id       => v_trip_id,
        p_order_number  => v_order_number,
        p_activity_type => v_activity_type,
        p_status        => v_status,
        p_attempt       => v_attempt,
        p_message       => v_message,
        p_detail_json   => v_detail_json,
        p_duration_ms   => v_duration_ms,
        p_result        => v_result
    );

    APEX_JSON.open_object;
    APEX_JSON.write('status',  v_result);
    APEX_JSON.write('agentId', v_agent_id);
    APEX_JSON.close_object;
END;


-- ============================================================
-- HANDLER 8: GET  agents/:agentId/activity
-- ============================================================
-- Module:        TRIPMANAGEMENT
-- URI Template:  agents/:agentId/activity
-- Method:        GET
-- Source Type:   SQL Query
-- URI Bind:      :agentId  (NUMBER)
-- Query String:  LIMIT  (optional, defaults to 100)
-- ============================================================
SELECT
    id,
    agent_id,
    trip_id,
    order_number,
    activity_type,
    status,
    attempt_number,
    message,
    detail_json,
    duration_ms,
    created_date
FROM wms_agents_activity_log
WHERE agent_id = :agentId
ORDER BY created_date DESC
FETCH FIRST NVL(TO_NUMBER(:LIMIT), 100) ROWS ONLY


-- ============================================================
-- HANDLER 9: GET  agents/:agentId/performance
-- ============================================================
-- Module:        TRIPMANAGEMENT
-- URI Template:  agents/:agentId/performance
-- Method:        GET
-- Source Type:   SQL Query
-- URI Bind:      :agentId  (NUMBER)
-- ============================================================
SELECT
    id,
    agent_id,
    perf_date,
    status_checks,
    prints_triggered,
    pick_releases,
    notifications_sent,
    anomalies_flagged,
    ai_calls,
    retries_total,
    errors_total,
    first_activity_time,
    last_activity_time,
    active_duration_seconds
FROM wms_agents_performance
WHERE agent_id = :agentId
ORDER BY perf_date DESC


-- ============================================================
-- HANDLER 10: GET  agents/performance/summary
-- ============================================================
-- Module:        TRIPMANAGEMENT
-- URI Template:  agents/performance/summary
-- Method:        GET
-- Source Type:   SQL Query
-- ============================================================
SELECT
    c.id                             AS agent_id,
    c.name                           AS agent_name,
    c.instance_name,
    c.status                         AS agent_status,
    c.capabilities,
    c.total_trips_processed,
    c.total_actions_taken,
    c.last_active_date,
    -- Today's counters (NULL if no activity today)
    p.perf_date,
    NVL(p.status_checks,      0)     AS status_checks_today,
    NVL(p.prints_triggered,   0)     AS prints_triggered_today,
    NVL(p.pick_releases,      0)     AS pick_releases_today,
    NVL(p.notifications_sent, 0)     AS notifications_sent_today,
    NVL(p.anomalies_flagged,  0)     AS anomalies_flagged_today,
    NVL(p.ai_calls,           0)     AS ai_calls_today,
    NVL(p.retries_total,      0)     AS retries_today,
    NVL(p.errors_total,       0)     AS errors_today,
    p.first_activity_time            AS first_activity_today,
    p.last_activity_time             AS last_activity_today,
    NVL(p.active_duration_seconds, 0) AS active_seconds_today,
    -- Active trips count
    (SELECT COUNT(*)
     FROM   wms_agents_trips t
     WHERE  t.agent_id = c.id
       AND  t.status NOT IN ('COMPLETED', 'FAILED')) AS active_trips
FROM wms_agents_config c
LEFT JOIN wms_agents_performance p
       ON p.agent_id  = c.id
      AND p.perf_date = TRUNC(SYSDATE)
ORDER BY c.id ASC


-- ============================================================
-- HANDLER 11: POST  agents/:agentId/close
-- ============================================================
-- Module:        TRIPMANAGEMENT
-- URI Template:  agents/:agentId/close
-- Method:        POST
-- Source Type:   PL/SQL
-- URI Bind:      :agentId  (NUMBER)
-- ============================================================
DECLARE
    v_result    VARCHAR2(200);
BEGIN
    wms_agents_close(
        p_agent_id => :agentId,
        p_result   => v_result
    );

    APEX_JSON.open_object;
    APEX_JSON.write('status',  v_result);
    APEX_JSON.write('agentId', :agentId);
    APEX_JSON.close_object;
END;


-- ============================================================
-- EXAMPLE CALLS
-- ============================================================
-- POST create agent:
--   URL:  https://<apex-base>/TRIPMANAGEMENT/agents/create
--   Body: { "name": "Overnight Monitor", "instanceName": "PROD",
--           "capabilities": "MONITOR,PRINT,NOTIFY", "checkIntervalSeconds": 60,
--           "maxRetries": 3, "createdBy": "ADMIN" }
--
-- GET all agents with today's stats:
--   URL:  https://<apex-base>/TRIPMANAGEMENT/agents/list
--
-- PUT update agent status:
--   URL:  https://<apex-base>/TRIPMANAGEMENT/agents/1/status
--   Body: { "status": "RUNNING" }
--
-- POST assign trip to agent:
--   URL:  https://<apex-base>/TRIPMANAGEMENT/agents/1/trips
--   Body: { "tripId": "TRIP-001", "tripName": "Overnight Run A", "instanceName": "PROD" }
--
-- DELETE unassign trip from agent:
--   URL:  https://<apex-base>/TRIPMANAGEMENT/agents/1/trips/TRIP-001
--
-- GET trips for agent 1:
--   URL:  https://<apex-base>/TRIPMANAGEMENT/agents/1/trips
--
-- POST log an activity:
--   URL:  https://<apex-base>/TRIPMANAGEMENT/agents/activity/log
--   Body: { "agentId": 1, "tripId": "TRIP-001", "orderNumber": "90105000006",
--           "activityType": "PRINT", "status": "SUCCESS", "attempt": 1,
--           "message": "Printed successfully", "durationMs": 423 }
--
-- GET recent activity for agent 1 (last 50):
--   URL:  https://<apex-base>/TRIPMANAGEMENT/agents/1/activity?LIMIT=50
--
-- GET performance history for agent 1:
--   URL:  https://<apex-base>/TRIPMANAGEMENT/agents/1/performance
--
-- GET summary of all agents with today's performance:
--   URL:  https://<apex-base>/TRIPMANAGEMENT/agents/performance/summary
-- ============================================================
