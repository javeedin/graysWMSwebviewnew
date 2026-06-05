-- ============================================================
-- WMS AGENTS - TABLES + PROCEDURES
-- ============================================================
-- Created: 2026-06-05
-- Purpose: Autonomous agent framework for trip/order monitoring,
--          printing, pick-release, notifications, and AI analysis
-- Tables:  WMS_AGENTS_CONFIG, WMS_AGENTS_TRIPS,
--          WMS_AGENTS_ACTIVITY_LOG, WMS_AGENTS_PERFORMANCE,
--          WMS_AGENTS_NOTIFICATIONS
-- ============================================================


-- ============================================================
-- STEP 1: CREATE TABLE WMS_AGENTS_CONFIG
-- ============================================================
CREATE TABLE wms_agents_config (
    id                          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name                        VARCHAR2(100)   NOT NULL,
    description                 VARCHAR2(500),
    instance_name               VARCHAR2(20)    DEFAULT 'PROD',
    capabilities                VARCHAR2(500),  -- comma-separated: MONITOR,PRINT,PICK_RELEASE,NOTIFY,ANOMALY,AI_ANALYSIS
    status                      VARCHAR2(20)    DEFAULT 'IDLE',  -- IDLE/RUNNING/PAUSED/COMPLETED/ERROR
    check_interval_seconds      NUMBER          DEFAULT 60,
    max_retries                 NUMBER          DEFAULT 3,
    created_by                  VARCHAR2(100),
    created_date                TIMESTAMP       DEFAULT SYSTIMESTAMP,
    last_active_date            TIMESTAMP,
    total_trips_processed       NUMBER          DEFAULT 0,
    total_actions_taken         NUMBER          DEFAULT 0
);

CREATE INDEX idx_wac_status        ON wms_agents_config(status);
CREATE INDEX idx_wac_instance      ON wms_agents_config(instance_name);
CREATE INDEX idx_wac_created_by    ON wms_agents_config(created_by);

COMMENT ON TABLE  wms_agents_config                         IS 'Agent definitions and configuration for autonomous WMS operations';
COMMENT ON COLUMN wms_agents_config.capabilities            IS 'Comma-separated capability flags: MONITOR,PRINT,PICK_RELEASE,NOTIFY,ANOMALY,AI_ANALYSIS';
COMMENT ON COLUMN wms_agents_config.status                  IS 'Agent lifecycle status: IDLE/RUNNING/PAUSED/COMPLETED/ERROR';
COMMENT ON COLUMN wms_agents_config.check_interval_seconds  IS 'How often the agent polls for work (seconds)';


-- ============================================================
-- STEP 2: CREATE TABLE WMS_AGENTS_TRIPS
-- ============================================================
CREATE TABLE wms_agents_trips (
    id                  NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    agent_id            NUMBER          NOT NULL,
    trip_id             VARCHAR2(100)   NOT NULL,
    trip_name           VARCHAR2(200),
    instance_name       VARCHAR2(20),
    status              VARCHAR2(20)    DEFAULT 'PENDING',  -- PENDING/ACTIVE/COMPLETED/FAILED
    assigned_date       TIMESTAMP       DEFAULT SYSTIMESTAMP,
    started_date        TIMESTAMP,
    completed_date      TIMESTAMP,
    orders_total        NUMBER          DEFAULT 0,
    orders_processed    NUMBER          DEFAULT 0,
    orders_printed      NUMBER          DEFAULT 0,
    orders_stuck        NUMBER          DEFAULT 0,
    anomalies_found     NUMBER          DEFAULT 0,
    notes               VARCHAR2(1000),
    CONSTRAINT fk_wat_agent_id FOREIGN KEY (agent_id) REFERENCES wms_agents_config(id)
);

CREATE INDEX idx_wat_agent_id     ON wms_agents_trips(agent_id);
CREATE INDEX idx_wat_trip_id      ON wms_agents_trips(trip_id);
CREATE INDEX idx_wat_status       ON wms_agents_trips(status);
CREATE INDEX idx_wat_instance     ON wms_agents_trips(instance_name);

COMMENT ON TABLE  wms_agents_trips              IS 'Trips assigned to agents for processing';
COMMENT ON COLUMN wms_agents_trips.status       IS 'Trip processing status: PENDING/ACTIVE/COMPLETED/FAILED';
COMMENT ON COLUMN wms_agents_trips.orders_stuck IS 'Count of orders that have not progressed and may need intervention';


-- ============================================================
-- STEP 3: CREATE TABLE WMS_AGENTS_ACTIVITY_LOG
-- ============================================================
CREATE TABLE wms_agents_activity_log (
    id              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    agent_id        NUMBER          NOT NULL,
    trip_id         VARCHAR2(100),
    order_number    VARCHAR2(100),
    activity_type   VARCHAR2(50),   -- CHECK_STATUS/PRINT/PICK_RELEASE/NOTIFY_PICKER/SHIP_CONFIRM/CANCEL_LINE/ANOMALY_DETECT/AI_ANALYSIS
    status          VARCHAR2(20),   -- SUCCESS/FAILED/RETRY/SKIPPED
    attempt_number  NUMBER          DEFAULT 1,
    message         VARCHAR2(2000),
    detail_json     CLOB,
    duration_ms     NUMBER,
    created_date    TIMESTAMP       DEFAULT SYSTIMESTAMP
);

CREATE INDEX idx_waal_agent_id      ON wms_agents_activity_log(agent_id);
CREATE INDEX idx_waal_trip_id       ON wms_agents_activity_log(trip_id);
CREATE INDEX idx_waal_order_number  ON wms_agents_activity_log(order_number);
CREATE INDEX idx_waal_activity_type ON wms_agents_activity_log(activity_type);
CREATE INDEX idx_waal_status        ON wms_agents_activity_log(status);
CREATE INDEX idx_waal_created_date  ON wms_agents_activity_log(created_date);

COMMENT ON TABLE  wms_agents_activity_log               IS 'Detailed log of every action taken by agents';
COMMENT ON COLUMN wms_agents_activity_log.activity_type IS 'CHECK_STATUS/PRINT/PICK_RELEASE/NOTIFY_PICKER/SHIP_CONFIRM/CANCEL_LINE/ANOMALY_DETECT/AI_ANALYSIS';
COMMENT ON COLUMN wms_agents_activity_log.status        IS 'Outcome: SUCCESS/FAILED/RETRY/SKIPPED';
COMMENT ON COLUMN wms_agents_activity_log.detail_json   IS 'Full JSON payload for debugging and auditing';


-- ============================================================
-- STEP 4: CREATE TABLE WMS_AGENTS_PERFORMANCE
-- ============================================================
CREATE TABLE wms_agents_performance (
    id                      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    agent_id                NUMBER          NOT NULL,
    perf_date               DATE            DEFAULT TRUNC(SYSDATE),
    status_checks           NUMBER          DEFAULT 0,
    prints_triggered        NUMBER          DEFAULT 0,
    pick_releases           NUMBER          DEFAULT 0,
    notifications_sent      NUMBER          DEFAULT 0,
    anomalies_flagged       NUMBER          DEFAULT 0,
    ai_calls                NUMBER          DEFAULT 0,
    retries_total           NUMBER          DEFAULT 0,
    errors_total            NUMBER          DEFAULT 0,
    first_activity_time     TIMESTAMP,
    last_activity_time      TIMESTAMP,
    active_duration_seconds NUMBER          DEFAULT 0,
    CONSTRAINT fk_wap_agent_id    FOREIGN KEY (agent_id) REFERENCES wms_agents_config(id),
    CONSTRAINT unique_agent_date  UNIQUE (agent_id, perf_date)
);

CREATE INDEX idx_wap_agent_id   ON wms_agents_performance(agent_id);
CREATE INDEX idx_wap_perf_date  ON wms_agents_performance(perf_date);

COMMENT ON TABLE  wms_agents_performance                    IS 'Daily performance counters per agent (one row per agent per day)';
COMMENT ON COLUMN wms_agents_performance.active_duration_seconds IS 'Total wall-clock seconds the agent was active on this date';


-- ============================================================
-- STEP 5: CREATE TABLE WMS_AGENTS_NOTIFICATIONS
-- ============================================================
CREATE TABLE wms_agents_notifications (
    id                  NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    agent_id            NUMBER          NOT NULL,
    trip_id             VARCHAR2(100),
    order_number        VARCHAR2(100),
    notification_type   VARCHAR2(50),   -- PICKER_ALERT/STUCK_ORDER/ANOMALY/COMPLETION
    message             VARCHAR2(2000),
    severity            VARCHAR2(10)    DEFAULT 'INFO',  -- INFO/WARN/ERROR
    sent_date           TIMESTAMP       DEFAULT SYSTIMESTAMP,
    acknowledged        NUMBER(1)       DEFAULT 0
);

CREATE INDEX idx_wan_agent_id           ON wms_agents_notifications(agent_id);
CREATE INDEX idx_wan_trip_id            ON wms_agents_notifications(trip_id);
CREATE INDEX idx_wan_notification_type  ON wms_agents_notifications(notification_type);
CREATE INDEX idx_wan_severity           ON wms_agents_notifications(severity);
CREATE INDEX idx_wan_acknowledged       ON wms_agents_notifications(acknowledged);

COMMENT ON TABLE  wms_agents_notifications                      IS 'Notifications generated by agents for pickers and supervisors';
COMMENT ON COLUMN wms_agents_notifications.notification_type    IS 'PICKER_ALERT/STUCK_ORDER/ANOMALY/COMPLETION';
COMMENT ON COLUMN wms_agents_notifications.severity             IS 'INFO/WARN/ERROR';
COMMENT ON COLUMN wms_agents_notifications.acknowledged         IS '0=unread, 1=acknowledged';


-- ============================================================
-- STEP 6: PROCEDURE wms_agents_create
--         Creates a new agent configuration record.
--         Returns the new agent ID via OUT parameter.
-- ============================================================
CREATE OR REPLACE PROCEDURE wms_agents_create (
    p_name              IN  VARCHAR2,
    p_description       IN  VARCHAR2,
    p_instance          IN  VARCHAR2,
    p_capabilities      IN  VARCHAR2,
    p_interval          IN  NUMBER,
    p_max_retries       IN  NUMBER,
    p_created_by        IN  VARCHAR2,
    p_agent_id          OUT NUMBER,
    p_result            OUT VARCHAR2
) AS
BEGIN
    INSERT INTO wms_agents_config (
        name,
        description,
        instance_name,
        capabilities,
        check_interval_seconds,
        max_retries,
        created_by,
        created_date,
        status
    ) VALUES (
        p_name,
        p_description,
        NVL(UPPER(p_instance), 'PROD'),
        p_capabilities,
        NVL(p_interval, 60),
        NVL(p_max_retries, 3),
        p_created_by,
        SYSTIMESTAMP,
        'IDLE'
    )
    RETURNING id INTO p_agent_id;

    COMMIT;
    p_result := 'SUCCESS';

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        p_agent_id := NULL;
        p_result   := 'ERROR: ' || SQLERRM;
END wms_agents_create;
/


-- ============================================================
-- STEP 7: PROCEDURE wms_agents_update_status
--         Updates an agent's status and last_active_date.
-- ============================================================
CREATE OR REPLACE PROCEDURE wms_agents_update_status (
    p_agent_id  IN  NUMBER,
    p_status    IN  VARCHAR2,
    p_result    OUT VARCHAR2
) AS
    v_count NUMBER;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM wms_agents_config
    WHERE id = p_agent_id;

    IF v_count = 0 THEN
        p_result := 'ERROR: Agent ID ' || p_agent_id || ' not found';
        RETURN;
    END IF;

    UPDATE wms_agents_config
    SET    status           = UPPER(p_status),
           last_active_date = SYSTIMESTAMP
    WHERE  id = p_agent_id;

    COMMIT;
    p_result := 'SUCCESS';

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        p_result := 'ERROR: ' || SQLERRM;
END wms_agents_update_status;
/


-- ============================================================
-- STEP 8: PROCEDURE wms_agents_assign_trip
--         Assigns a trip to an agent. Prevents duplicate assignment.
-- ============================================================
CREATE OR REPLACE PROCEDURE wms_agents_assign_trip (
    p_agent_id  IN  NUMBER,
    p_trip_id   IN  VARCHAR2,
    p_trip_name IN  VARCHAR2,
    p_instance  IN  VARCHAR2,
    p_result    OUT VARCHAR2
) AS
    v_count NUMBER;
BEGIN
    -- Check agent exists
    SELECT COUNT(*) INTO v_count
    FROM wms_agents_config
    WHERE id = p_agent_id;

    IF v_count = 0 THEN
        p_result := 'ERROR: Agent ID ' || p_agent_id || ' not found';
        RETURN;
    END IF;

    -- Check not already assigned
    SELECT COUNT(*) INTO v_count
    FROM wms_agents_trips
    WHERE agent_id = p_agent_id
      AND trip_id  = p_trip_id;

    IF v_count > 0 THEN
        p_result := 'ERROR: Trip ' || p_trip_id || ' is already assigned to agent ' || p_agent_id;
        RETURN;
    END IF;

    INSERT INTO wms_agents_trips (
        agent_id,
        trip_id,
        trip_name,
        instance_name,
        status,
        assigned_date
    ) VALUES (
        p_agent_id,
        p_trip_id,
        p_trip_name,
        NVL(UPPER(p_instance), 'PROD'),
        'PENDING',
        SYSTIMESTAMP
    );

    COMMIT;
    p_result := 'SUCCESS';

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        p_result := 'ERROR: ' || SQLERRM;
END wms_agents_assign_trip;
/


-- ============================================================
-- STEP 9: PROCEDURE wms_agents_unassign_trip
--         Removes a trip assignment from an agent.
-- ============================================================
CREATE OR REPLACE PROCEDURE wms_agents_unassign_trip (
    p_agent_id  IN  NUMBER,
    p_trip_id   IN  VARCHAR2,
    p_result    OUT VARCHAR2
) AS
    v_count NUMBER;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM wms_agents_trips
    WHERE agent_id = p_agent_id
      AND trip_id  = p_trip_id;

    IF v_count = 0 THEN
        p_result := 'ERROR: Trip ' || p_trip_id || ' is not assigned to agent ' || p_agent_id;
        RETURN;
    END IF;

    DELETE FROM wms_agents_trips
    WHERE agent_id = p_agent_id
      AND trip_id  = p_trip_id;

    COMMIT;
    p_result := 'SUCCESS';

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        p_result := 'ERROR: ' || SQLERRM;
END wms_agents_unassign_trip;
/


-- ============================================================
-- STEP 10: PROCEDURE wms_agents_log_activity
--          Inserts an activity log row, upserts today's
--          performance counters, and updates the agent's
--          last_active_date and total_actions_taken.
-- ============================================================
CREATE OR REPLACE PROCEDURE wms_agents_log_activity (
    p_agent_id      IN  NUMBER,
    p_trip_id       IN  VARCHAR2,
    p_order_number  IN  VARCHAR2,
    p_activity_type IN  VARCHAR2,
    p_status        IN  VARCHAR2,
    p_attempt       IN  NUMBER,
    p_message       IN  VARCHAR2,
    p_detail_json   IN  CLOB,
    p_duration_ms   IN  NUMBER,
    p_result        OUT VARCHAR2
) AS
    v_now   TIMESTAMP := SYSTIMESTAMP;
    v_today DATE      := TRUNC(SYSDATE);
BEGIN
    -- 1. Insert activity log row
    INSERT INTO wms_agents_activity_log (
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
    ) VALUES (
        p_agent_id,
        p_trip_id,
        p_order_number,
        UPPER(p_activity_type),
        UPPER(p_status),
        NVL(p_attempt, 1),
        p_message,
        p_detail_json,
        p_duration_ms,
        v_now
    );

    -- 2. Upsert today's performance row; increment the correct counter
    --    based on activity_type and status.
    MERGE INTO wms_agents_performance tgt
    USING (SELECT p_agent_id AS agent_id, v_today AS perf_date FROM DUAL) src
    ON (tgt.agent_id = src.agent_id AND tgt.perf_date = src.perf_date)
    WHEN MATCHED THEN
        UPDATE SET
            status_checks       = tgt.status_checks      + CASE WHEN UPPER(p_activity_type) = 'CHECK_STATUS'    THEN 1 ELSE 0 END,
            prints_triggered    = tgt.prints_triggered   + CASE WHEN UPPER(p_activity_type) = 'PRINT'           AND UPPER(p_status) = 'SUCCESS' THEN 1 ELSE 0 END,
            pick_releases       = tgt.pick_releases      + CASE WHEN UPPER(p_activity_type) = 'PICK_RELEASE'    AND UPPER(p_status) = 'SUCCESS' THEN 1 ELSE 0 END,
            notifications_sent  = tgt.notifications_sent + CASE WHEN UPPER(p_activity_type) = 'NOTIFY_PICKER'   AND UPPER(p_status) = 'SUCCESS' THEN 1 ELSE 0 END,
            anomalies_flagged   = tgt.anomalies_flagged  + CASE WHEN UPPER(p_activity_type) = 'ANOMALY_DETECT'  AND UPPER(p_status) = 'SUCCESS' THEN 1 ELSE 0 END,
            ai_calls            = tgt.ai_calls           + CASE WHEN UPPER(p_activity_type) = 'AI_ANALYSIS'     THEN 1 ELSE 0 END,
            retries_total       = tgt.retries_total      + CASE WHEN UPPER(p_status)        = 'RETRY'           THEN 1 ELSE 0 END,
            errors_total        = tgt.errors_total       + CASE WHEN UPPER(p_status)        = 'FAILED'          THEN 1 ELSE 0 END,
            last_activity_time  = v_now,
            first_activity_time = NVL(tgt.first_activity_time, v_now)
    WHEN NOT MATCHED THEN
        INSERT (
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
            last_activity_time
        ) VALUES (
            p_agent_id,
            v_today,
            CASE WHEN UPPER(p_activity_type) = 'CHECK_STATUS'   THEN 1 ELSE 0 END,
            CASE WHEN UPPER(p_activity_type) = 'PRINT'          AND UPPER(p_status) = 'SUCCESS' THEN 1 ELSE 0 END,
            CASE WHEN UPPER(p_activity_type) = 'PICK_RELEASE'   AND UPPER(p_status) = 'SUCCESS' THEN 1 ELSE 0 END,
            CASE WHEN UPPER(p_activity_type) = 'NOTIFY_PICKER'  AND UPPER(p_status) = 'SUCCESS' THEN 1 ELSE 0 END,
            CASE WHEN UPPER(p_activity_type) = 'ANOMALY_DETECT' AND UPPER(p_status) = 'SUCCESS' THEN 1 ELSE 0 END,
            CASE WHEN UPPER(p_activity_type) = 'AI_ANALYSIS'    THEN 1 ELSE 0 END,
            CASE WHEN UPPER(p_status)        = 'RETRY'          THEN 1 ELSE 0 END,
            CASE WHEN UPPER(p_status)        = 'FAILED'         THEN 1 ELSE 0 END,
            v_now,
            v_now
        );

    -- 3. Update agent last_active_date and total_actions_taken
    UPDATE wms_agents_config
    SET    last_active_date    = v_now,
           total_actions_taken = total_actions_taken + 1
    WHERE  id = p_agent_id;

    COMMIT;
    p_result := 'SUCCESS';

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        p_result := 'ERROR: ' || SQLERRM;
END wms_agents_log_activity;
/


-- ============================================================
-- STEP 11: PROCEDURE wms_agents_log_notification
--          Records a notification generated by an agent.
-- ============================================================
CREATE OR REPLACE PROCEDURE wms_agents_log_notification (
    p_agent_id      IN  NUMBER,
    p_trip_id       IN  VARCHAR2,
    p_order_number  IN  VARCHAR2,
    p_notif_type    IN  VARCHAR2,
    p_message       IN  VARCHAR2,
    p_severity      IN  VARCHAR2,
    p_result        OUT VARCHAR2
) AS
BEGIN
    INSERT INTO wms_agents_notifications (
        agent_id,
        trip_id,
        order_number,
        notification_type,
        message,
        severity,
        sent_date,
        acknowledged
    ) VALUES (
        p_agent_id,
        p_trip_id,
        p_order_number,
        UPPER(p_notif_type),
        p_message,
        NVL(UPPER(p_severity), 'INFO'),
        SYSTIMESTAMP,
        0
    );

    COMMIT;
    p_result := 'SUCCESS';

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        p_result := 'ERROR: ' || SQLERRM;
END wms_agents_log_notification;
/


-- ============================================================
-- STEP 12: PROCEDURE wms_agents_update_trip_stats
--          Updates progress counters and status on a trip row.
-- ============================================================
CREATE OR REPLACE PROCEDURE wms_agents_update_trip_stats (
    p_agent_id          IN  NUMBER,
    p_trip_id           IN  VARCHAR2,
    p_status            IN  VARCHAR2,
    p_orders_total      IN  NUMBER,
    p_orders_processed  IN  NUMBER,
    p_orders_printed    IN  NUMBER,
    p_orders_stuck      IN  NUMBER,
    p_anomalies         IN  NUMBER,
    p_result            OUT VARCHAR2
) AS
    v_count NUMBER;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM wms_agents_trips
    WHERE agent_id = p_agent_id
      AND trip_id  = p_trip_id;

    IF v_count = 0 THEN
        p_result := 'ERROR: Trip ' || p_trip_id || ' is not assigned to agent ' || p_agent_id;
        RETURN;
    END IF;

    UPDATE wms_agents_trips
    SET    status            = NVL(UPPER(p_status), status),
           orders_total      = NVL(p_orders_total,     orders_total),
           orders_processed  = NVL(p_orders_processed, orders_processed),
           orders_printed    = NVL(p_orders_printed,   orders_printed),
           orders_stuck      = NVL(p_orders_stuck,     orders_stuck),
           anomalies_found   = NVL(p_anomalies,        anomalies_found),
           started_date      = CASE
                                   WHEN UPPER(p_status) = 'ACTIVE'    AND started_date    IS NULL THEN SYSTIMESTAMP
                                   ELSE started_date
                               END,
           completed_date    = CASE
                                   WHEN UPPER(p_status) IN ('COMPLETED', 'FAILED') AND completed_date IS NULL THEN SYSTIMESTAMP
                                   ELSE completed_date
                               END
    WHERE  agent_id = p_agent_id
      AND  trip_id  = p_trip_id;

    -- Also bump total_trips_processed on the agent when a trip completes
    IF UPPER(p_status) = 'COMPLETED' THEN
        UPDATE wms_agents_config
        SET    total_trips_processed = total_trips_processed + 1,
               last_active_date      = SYSTIMESTAMP
        WHERE  id = p_agent_id;
    END IF;

    COMMIT;
    p_result := 'SUCCESS';

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        p_result := 'ERROR: ' || SQLERRM;
END wms_agents_update_trip_stats;
/


-- ============================================================
-- STEP 13: QUICK TEST
-- ============================================================
/*
-- Verify tables created:
SELECT table_name FROM user_tables
WHERE table_name IN (
    'WMS_AGENTS_CONFIG',
    'WMS_AGENTS_TRIPS',
    'WMS_AGENTS_ACTIVITY_LOG',
    'WMS_AGENTS_PERFORMANCE',
    'WMS_AGENTS_NOTIFICATIONS'
)
ORDER BY table_name;

-- Verify procedures compiled:
SELECT object_name, status FROM user_objects
WHERE object_name IN (
    'WMS_AGENTS_CREATE',
    'WMS_AGENTS_UPDATE_STATUS',
    'WMS_AGENTS_ASSIGN_TRIP',
    'WMS_AGENTS_UNASSIGN_TRIP',
    'WMS_AGENTS_LOG_ACTIVITY',
    'WMS_AGENTS_LOG_NOTIFICATION',
    'WMS_AGENTS_UPDATE_TRIP_STATS'
)
ORDER BY object_name;

-- Smoke test: create an agent
DECLARE
    v_id     NUMBER;
    v_result VARCHAR2(200);
BEGIN
    wms_agents_create(
        p_name         => 'Test Agent 1',
        p_description  => 'Smoke test agent',
        p_instance     => 'PROD',
        p_capabilities => 'MONITOR,PRINT,NOTIFY',
        p_interval     => 60,
        p_max_retries  => 3,
        p_created_by   => 'ADMIN',
        p_agent_id     => v_id,
        p_result       => v_result
    );
    DBMS_OUTPUT.PUT_LINE('Result: ' || v_result || '  ID: ' || v_id);
END;
/

-- Verify:
SELECT id, name, status, capabilities FROM wms_agents_config;
*/
