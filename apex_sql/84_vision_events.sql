-- 84_vision_events.sql — events of the AI Agent's Vision watches (aiagent/vision-watch.js, classes/VisionWatch.cs).
-- The page creates this table on first use; this script is for a manual setup or a review.
-- A watch (webcam / RTSP camera / video file) runs on a PC; every event it raises (motion in a zone, a crossing of the
-- counting line, a barcode read, YOLO objects arriving) is inserted here by the page that shows it. Snapshots stay on the
-- PC (%LOCALAPPDATA%\GraysWMS\vision-watches\<watch>\run-…\snaps, the last 5 runs per watch).
CREATE TABLE wms_vision_events (
    id            NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    watch_id      VARCHAR2(40)   NOT NULL,      -- id in %APPDATA%\GraysWMS\Vision\watches.json of that PC
    watch_name    VARCHAR2(200),
    run_id        VARCHAR2(40),                 -- run-YYYYMMDD-HHMMSS: one start of the watch
    event_no      NUMBER,                       -- 1, 2, 3 … within the run
    event_type    VARCHAR2(30),                 -- motion | motion_end | cross | code | objects
    event_at      DATE,                         -- the PC's local time
    video_s       NUMBER,                       -- position in the video (video files only)
    zone          VARCHAR2(100),
    direction     VARCHAR2(10),                 -- in | out (line counting)
    label         VARCHAR2(100),                -- YOLO class of a crossing
    code_data     VARCHAR2(1000),               -- barcode text
    alert_flag    CHAR(1),                      -- Y = inside the alert hours
    details       VARCHAR2(4000),               -- the rest of the event as JSON
    app_user      VARCHAR2(100),
    created_date  DATE DEFAULT SYSDATE
);
CREATE INDEX wms_vision_events_ix1 ON wms_vision_events (watch_id, event_at);

-- Door counts per hour today (a line-counting watch):
-- SELECT TO_CHAR(event_at, 'HH24') AS hr, SUM(CASE direction WHEN 'in' THEN 1 END) AS in_cnt, SUM(CASE direction WHEN 'out' THEN 1 END) AS out_cnt
--   FROM wms_vision_events WHERE watch_name = 'Dock door 3' AND event_type = 'cross' AND event_at >= TRUNC(SYSDATE) GROUP BY TO_CHAR(event_at, 'HH24') ORDER BY 1;
