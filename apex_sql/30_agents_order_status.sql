-- ============================================================
-- WMS SHIPPING AGENTS - ORDER STATUS PERSISTENCE
-- ============================================================
-- File:    30_agents_order_status.sql
-- Prereq:  29_agents.sql, 29b_agents_rest_handlers.sql
-- Run in:  APEX SQL Workshop
-- ============================================================


-- ============================================================
-- TABLE: WMS_SHIPING_AGENTS_ORDERS_STATUS
-- ============================================================
-- One row per (agent_id, trip_id, order_number, instance_name)
-- Fully replaced (DELETE + INSERT) on every shipment lines fetch
-- ============================================================
CREATE TABLE wms_shiping_agents_orders_status (
    id                  NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    agent_id            NUMBER          NOT NULL,
    trip_id             VARCHAR2(100)   NOT NULL,
    order_number        VARCHAR2(100)   NOT NULL,
    instance_name       VARCHAR2(20)    DEFAULT 'PROD',
    account_name        VARCHAR2(500),
    order_type          VARCHAR2(200),
    -- Overall dominant status
    order_status        VARCHAR2(100),
    -- Shipment line counts (from Fusion shipmentLines API)
    total_lines         NUMBER DEFAULT 0,
    active_lines        NUMBER DEFAULT 0,    -- total - cancelled
    staged_lines        NUMBER DEFAULT 0,    -- LineStatusCode = C
    interfaced_lines    NUMBER DEFAULT 0,    -- LineStatusCode = Y or Pending inventory processing
    released_lines      NUMBER DEFAULT 0,    -- Released to Warehouse
    ready_lines         NUMBER DEFAULT 0,    -- Ready to Release
    cancelled_lines     NUMBER DEFAULT 0,    -- LineStatusCode = X
    backorder_lines     NUMBER DEFAULT 0,    -- other/unrecognised status
    -- Derived picking / shipping counts
    picked_count        NUMBER DEFAULT 0,    -- staged + interfaced
    shipped_count       NUMBER DEFAULT 0,    -- interfaced only
    -- Quantities (from Fusion response)
    total_qty           NUMBER DEFAULT 0,
    staged_qty          NUMBER DEFAULT 0,
    shipped_qty         NUMBER DEFAULT 0,
    -- Sales order lines count (from getsalesorderlines API)
    order_lines_count   NUMBER DEFAULT 0,
    -- Print status (from wms_print_jobs)
    print_total         NUMBER DEFAULT 0,
    print_printed       NUMBER DEFAULT 0,
    -- Timestamps
    last_fetched        TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    created_date        TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
    -- Unique constraint: one row per order per agent/trip/instance
    CONSTRAINT uq_saos UNIQUE (agent_id, trip_id, order_number, instance_name)
);

CREATE INDEX idx_saos_agent_trip ON wms_shiping_agents_orders_status (agent_id, trip_id);
CREATE INDEX idx_saos_order      ON wms_shiping_agents_orders_status (order_number, instance_name);


-- ============================================================
-- APEX REST HANDLERS
-- Add these to the existing TRIPMANAGEMENT module
-- ============================================================


-- ============================================================
-- HANDLER A: POST  agents/orders/status/save
-- ============================================================
-- Module:        TRIPMANAGEMENT
-- URI Template:  agents/orders/status/save
-- Method:        POST
-- Source Type:   PL/SQL
-- ============================================================
-- Body JSON:
-- {
--   "agentId":          1,
--   "tripId":           "5279",
--   "orderNumber":      "75626003240",
--   "instanceName":     "PROD",
--   "accountName":      "ACME Ltd",
--   "orderType":        "Standard",
--   "orderStatus":      "Interfaced",
--   "totalLines":       10,
--   "activeLines":      9,
--   "stagedLines":      2,
--   "interfacedLines":  7,
--   "releasedLines":    0,
--   "readyLines":       0,
--   "cancelledLines":   1,
--   "backorderLines":   0,
--   "pickedCount":      9,
--   "shippedCount":     7,
--   "totalQty":         50,
--   "stagedQty":        10,
--   "shippedQty":       35,
--   "orderLinesCount":  5
-- }
-- Note: printTotal / printPrinted are NOT passed by JS.
--       They are queried live from wms_print_jobs to ensure accuracy.
-- ============================================================
DECLARE
    v_agent_id          NUMBER;
    v_trip_id           VARCHAR2(100);
    v_order_number      VARCHAR2(100);
    v_instance_name     VARCHAR2(20);
    v_account_name      VARCHAR2(500);
    v_order_type        VARCHAR2(200);
    v_order_status      VARCHAR2(100);
    v_total_lines       NUMBER;
    v_active_lines      NUMBER;
    v_staged_lines      NUMBER;
    v_interfaced_lines  NUMBER;
    v_released_lines    NUMBER;
    v_ready_lines       NUMBER;
    v_cancelled_lines   NUMBER;
    v_backorder_lines   NUMBER;
    v_picked_count      NUMBER;
    v_shipped_count     NUMBER;
    v_total_qty         NUMBER;
    v_staged_qty        NUMBER;
    v_shipped_qty       NUMBER;
    v_order_lines_count NUMBER;
    -- Print counts fetched live from wms_print_jobs (not passed by JS)
    v_print_total       NUMBER := 0;
    v_print_printed     NUMBER := 0;
    v_body              CLOB;

BEGIN
    v_body := :body;
    APEX_JSON.parse(v_body);

    v_agent_id          := APEX_JSON.get_number('agentId');
    v_trip_id           := APEX_JSON.get_varchar2('tripId');
    v_order_number      := APEX_JSON.get_varchar2('orderNumber');
    v_instance_name     := NVL(UPPER(APEX_JSON.get_varchar2('instanceName')), 'PROD');
    v_account_name      := APEX_JSON.get_varchar2('accountName');
    v_order_type        := APEX_JSON.get_varchar2('orderType');
    v_order_status      := APEX_JSON.get_varchar2('orderStatus');
    v_total_lines       := NVL(APEX_JSON.get_number('totalLines'),      0);
    v_active_lines      := NVL(APEX_JSON.get_number('activeLines'),     0);
    v_staged_lines      := NVL(APEX_JSON.get_number('stagedLines'),     0);
    v_interfaced_lines  := NVL(APEX_JSON.get_number('interfacedLines'), 0);
    v_released_lines    := NVL(APEX_JSON.get_number('releasedLines'),   0);
    v_ready_lines       := NVL(APEX_JSON.get_number('readyLines'),      0);
    v_cancelled_lines   := NVL(APEX_JSON.get_number('cancelledLines'),  0);
    v_backorder_lines   := NVL(APEX_JSON.get_number('backorderLines'),  0);
    v_picked_count      := NVL(APEX_JSON.get_number('pickedCount'),     0);
    v_shipped_count     := NVL(APEX_JSON.get_number('shippedCount'),    0);
    v_total_qty         := NVL(APEX_JSON.get_number('totalQty'),        0);
    v_staged_qty        := NVL(APEX_JSON.get_number('stagedQty'),       0);
    v_shipped_qty       := NVL(APEX_JSON.get_number('shippedQty'),      0);
    v_order_lines_count := NVL(APEX_JSON.get_number('orderLinesCount'), 0);

    -- Fetch live print counts from wms_print_jobs (source of truth)
    SELECT COUNT(*),
           COUNT(CASE WHEN UPPER(print_status) = 'PRINTED' THEN 1 END)
    INTO   v_print_total, v_print_printed
    FROM   wms_print_jobs
    WHERE  order_number   = v_order_number
      AND  instance_name  = v_instance_name;

    -- DELETE existing record for this agent/trip/order (full refresh)
    DELETE FROM wms_shiping_agents_orders_status
    WHERE agent_id     = v_agent_id
      AND trip_id      = v_trip_id
      AND order_number = v_order_number
      AND instance_name = v_instance_name;

    -- INSERT fresh record with live print counts
    INSERT INTO wms_shiping_agents_orders_status (
        agent_id, trip_id, order_number, instance_name,
        account_name, order_type, order_status,
        total_lines, active_lines, staged_lines, interfaced_lines,
        released_lines, ready_lines, cancelled_lines, backorder_lines,
        picked_count, shipped_count,
        total_qty, staged_qty, shipped_qty,
        order_lines_count, print_total, print_printed,
        last_fetched, created_date
    ) VALUES (
        v_agent_id, v_trip_id, v_order_number, v_instance_name,
        v_account_name, v_order_type, v_order_status,
        v_total_lines, v_active_lines, v_staged_lines, v_interfaced_lines,
        v_released_lines, v_ready_lines, v_cancelled_lines, v_backorder_lines,
        v_picked_count, v_shipped_count,
        v_total_qty, v_staged_qty, v_shipped_qty,
        v_order_lines_count, v_print_total, v_print_printed,
        SYSTIMESTAMP, SYSTIMESTAMP
    );

    COMMIT;

    HTP.p('{"status":"ok","orderNumber":"' || v_order_number || '","printTotal":' || v_print_total || ',"printPrinted":' || v_print_printed || '}');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.p('{"status":"error","message":"' || REPLACE(SQLERRM, '"', '''') || '"}');
END;


-- ============================================================
-- HANDLER B: GET  agents/:agentId/trips/:tripId/orders/status
-- ============================================================
-- Module:        TRIPMANAGEMENT
-- URI Template:  agents/:agentId/trips/:tripId/orders/status
-- Method:        GET
-- Source Type:   SQL Query
-- URI Bind:      :agentId (NUMBER), :tripId (VARCHAR2)
-- ============================================================
SELECT
    id,
    agent_id,
    trip_id,
    order_number,
    instance_name,
    account_name,
    order_type,
    order_status,
    total_lines,
    active_lines,
    staged_lines,
    interfaced_lines,
    released_lines,
    ready_lines,
    cancelled_lines,
    backorder_lines,
    picked_count,
    shipped_count,
    total_qty,
    staged_qty,
    shipped_qty,
    order_lines_count,
    print_total,
    print_printed,
    last_fetched,
    created_date
FROM wms_shiping_agents_orders_status
WHERE agent_id = :agentId
  AND trip_id  = :tripId
ORDER BY order_number


-- ============================================================
-- HANDLER C: DELETE  agents/:agentId/trips/:tripId/orders/status
-- ============================================================
-- Module:        TRIPMANAGEMENT
-- URI Template:  agents/:agentId/trips/:tripId/orders/status
-- Method:        DELETE
-- Source Type:   PL/SQL
-- (Called before a full re-fetch of all orders for a trip)
-- ============================================================
BEGIN
    DELETE FROM wms_shiping_agents_orders_status
    WHERE agent_id = :agentId
      AND trip_id  = :tripId;
    COMMIT;
    HTP.p('{"status":"ok","deleted":' || SQL%ROWCOUNT || '}');
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        HTP.p('{"status":"error","message":"' || REPLACE(SQLERRM, '"', '''') || '"}');
END;


-- ============================================================
-- TEST QUERIES
-- ============================================================

-- Check saved statuses for agent 1
SELECT * FROM wms_shiping_agents_orders_status WHERE agent_id = 1 ORDER BY last_fetched DESC;

-- Count by order status
SELECT order_status, COUNT(*) AS cnt
FROM wms_shiping_agents_orders_status
GROUP BY order_status
ORDER BY cnt DESC;
