-- ============================================================
-- WMS ACTIVITY INTELLIGENCE - logging & voice feedback tables
-- ============================================================
-- Stores what users do (task mining) and their spoken feedback
-- (pain areas). Rows are written by the client through the SAME
-- guarded write endpoint the AI bot uses:
--     POST /WAREHOUSEMANAGEMENT/ai/executewrite   { sql, appUser }
-- The tracker batches many events into ONE "INSERT ALL ... SELECT
-- * FROM dual" statement (a single statement, so it passes the
-- write guard). Feedback is one INSERT per utterance.
--
-- Run in SQL Workshop > SQL Commands, after 37/47 (the write guard).
-- ============================================================

-- ── raw activity events (one row per event) ─────────────────
CREATE TABLE wms_activity_log (
    id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_ts      TIMESTAMP      DEFAULT SYSTIMESTAMP NOT NULL,  -- when it happened (client time)
    session_id    VARCHAR2(40),          -- one app run
    user_name     VARCHAR2(100),
    app_ver       VARCHAR2(20),
    instance      VARCHAR2(20),          -- PROD / TEST
    module        VARCHAR2(40),          -- wms / inventory / aianalysis ...
    page          VARCHAR2(80),          -- data-page / logical screen
    event_type    VARCHAR2(30),          -- nav / click / entity_view / search / dialog / api_call / action / idle / error / session_start / session_end
    target        VARCHAR2(200),         -- control id or text
    entity_type   VARCHAR2(30),          -- TRIP / ORDER / PRINTER / CUSTOMER ...
    entity_id     VARCHAR2(100),         -- 7832 / 418978 ...
    dur_ms        NUMBER,                -- dwell / open duration / elapsed
    meta          CLOB,                  -- small JSON: extra context
    created_on    DATE           DEFAULT SYSDATE
);
CREATE INDEX wms_act_user_ts_ix  ON wms_activity_log (user_name, event_ts);
CREATE INDEX wms_act_entity_ix   ON wms_activity_log (entity_type, entity_id);
CREATE INDEX wms_act_type_ix     ON wms_activity_log (event_type);
CREATE INDEX wms_act_session_ix  ON wms_activity_log (session_id);

-- ── voice / typed feedback (pain areas, user's own words) ───
CREATE TABLE wms_user_feedback (
    id             NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    feedback_ts    TIMESTAMP     DEFAULT SYSTIMESTAMP NOT NULL,
    session_id     VARCHAR2(40),
    user_name      VARCHAR2(100),
    app_ver        VARCHAR2(20),
    instance       VARCHAR2(20),
    module         VARCHAR2(40),
    page           VARCHAR2(80),          -- screen the user was on when speaking
    entity_type    VARCHAR2(30),          -- context: which trip / order they were viewing
    entity_id      VARCHAR2(100),
    source         VARCHAR2(10)  DEFAULT 'VOICE',  -- VOICE / TEXT
    lang           VARCHAR2(10),          -- spoken language code (en-US, fr-FR, hi-IN ...)
    text_raw       CLOB,                  -- transcript in the spoken language
    text_en        CLOB,                  -- English translation (raw copy until translated)
    trans_status   VARCHAR2(12)  DEFAULT 'RAW',   -- RAW (needs translation) / DONE / SAME (already English)
    sentiment      VARCHAR2(12),          -- optional, filled by AI later
    theme          VARCHAR2(60),          -- optional, AI-tagged pain theme
    created_on     DATE          DEFAULT SYSDATE
);
CREATE INDEX wms_fb_user_ts_ix ON wms_user_feedback (user_name, feedback_ts);
CREATE INDEX wms_fb_status_ix  ON wms_user_feedback (trans_status);

-- ── analysis views ──────────────────────────────────────────
-- time per page per user per day, idle-corrected (idle events carry
-- their duration and are excluded from "active" dwell)
CREATE OR REPLACE VIEW wms_activity_day_v AS
SELECT user_name,
       TRUNC(event_ts)                              AS activity_day,
       module, page,
       COUNT(*)                                     AS events,
       SUM(CASE WHEN event_type = 'nav'   THEN 1 ELSE 0 END) AS visits,
       ROUND(SUM(CASE WHEN event_type = 'nav' THEN NVL(dur_ms,0) ELSE 0 END)/60000, 1) AS dwell_minutes,
       MIN(event_ts)                                AS first_seen,
       MAX(event_ts)                                AS last_seen
FROM   wms_activity_log
WHERE  event_type <> 'idle'
GROUP  BY user_name, TRUNC(event_ts), module, page;

-- which business entities each user touches, and how often revisited
CREATE OR REPLACE VIEW wms_activity_entity_v AS
SELECT user_name,
       TRUNC(event_ts)   AS activity_day,
       entity_type, entity_id,
       COUNT(*)          AS touches,
       MIN(event_ts)     AS first_touch,
       MAX(event_ts)     AS last_touch
FROM   wms_activity_log
WHERE  entity_type IS NOT NULL AND entity_id IS NOT NULL
GROUP  BY user_name, TRUNC(event_ts), entity_type, entity_id;

-- events-by-hour heatmap source
CREATE OR REPLACE VIEW wms_activity_hour_v AS
SELECT user_name,
       TO_CHAR(event_ts, 'DY')                 AS weekday,
       TO_NUMBER(TO_CHAR(event_ts, 'HH24'))    AS hour_of_day,
       COUNT(*)                                AS events
FROM   wms_activity_log
GROUP  BY user_name, TO_CHAR(event_ts, 'DY'), TO_NUMBER(TO_CHAR(event_ts, 'HH24'));

-- ── mined sequences (Phase 3 fills this; created now so the
--    endpoint and UI can reference it) ─────────────────────────
CREATE TABLE wms_activity_seq (
    id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    signature     VARCHAR2(500),         -- e.g. "nav:trip-management > entity_view:TRIP > action:update-ship-date"
    steps         CLOB,                  -- JSON: ordered steps with pages/entities
    support_cnt   NUMBER,                -- how many times observed
    user_scope    VARCHAR2(100),         -- a user, or ALL
    avg_dur_ms    NUMBER,
    tod_profile   VARCHAR2(200),         -- typical time-of-day
    status        VARCHAR2(15) DEFAULT 'NEW',  -- NEW / PROPOSED / AUTOMATED / DISMISSED
    process_key   VARCHAR2(100),         -- link to WMS_AI_PROCESSES when automated
    first_seen    DATE,
    last_seen     DATE,
    updated_on    DATE DEFAULT SYSDATE
);

-- ── retention purge (schedule daily, or run manually) ───────
-- keep 90 days of raw events; feedback and sequences are kept.
-- Run as its own statement through the write endpoint or SQL Commands:
--   DELETE FROM wms_activity_log WHERE event_ts < SYSTIMESTAMP - INTERVAL '90' DAY;

COMMIT;

-- ============================================================
-- VERIFY the batch insert shape the tracker uses (single stmt):
--   INSERT ALL
--     INTO wms_activity_log (session_id,user_name,app_ver,instance,module,page,event_type,target,entity_type,entity_id,dur_ms,meta,event_ts)
--       VALUES ('S1','ALI','9.0.1','PROD','wms','trip-management','nav','trip-management',NULL,NULL,4200,NULL,SYSTIMESTAMP)
--     INTO wms_activity_log (session_id,user_name,app_ver,instance,module,page,event_type,target,entity_type,entity_id,dur_ms,meta,event_ts)
--       VALUES ('S1','ALI','9.0.1','PROD','wms','trip-management','entity_view','btn-asl','TRIP','7832',NULL,NULL,SYSTIMESTAMP)
--   SELECT * FROM dual;
-- and one feedback row:
--   INSERT INTO wms_user_feedback (user_name,page,source,lang,text_raw,text_en,trans_status)
--     VALUES ('ALI','trip-management','VOICE','en-US','this screen is slow','this screen is slow','SAME');
-- ============================================================
