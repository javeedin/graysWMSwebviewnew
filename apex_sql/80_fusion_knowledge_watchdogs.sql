-- ============================================================================
-- 80_fusion_knowledge_watchdogs.sql
-- Fusion SQL › Knowledge and Watchdogs. The Fusion SQL page creates these tables itself on first use
-- (fusionsql/knowledge.js, fusionsql/watchdogs.js through ai/executewrite); run this only to create them by hand.
-- ============================================================================

-- ── Knowledge: what Fusion SQL has learned about THIS company's Fusion ──────────
-- kind   : TABLE | COLUMN (what a flexfield / generic column holds) | VALUE (codes used) | JOIN | RULE | TERM | EXAMPLE
-- status : PROPOSED (learned / suggested, not used yet) → APPROVED (sent with every Ask AI question) | REJECTED
-- source : USER | AI (Ask AI ```knowledge block) | LEARNED (from saved queries) | VERIFIED (👍 Correct on an answer)
CREATE TABLE wms_fusion_knowledge (
    fact_id       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fact_key      VARCHAR2(400)  NOT NULL,          -- dedup key: KIND|OBJECT.COLUMN|...
    kind          VARCHAR2(10)   NOT NULL,
    object_name   VARCHAR2(128),
    column_name   VARCHAR2(128),
    fact          VARCHAR2(2000) NOT NULL,          -- for EXAMPLE: the question
    words         VARCHAR2(400),                    -- business words people use for it
    example_sql   VARCHAR2(4000),                   -- for EXAMPLE: the verified SQL
    source        VARCHAR2(10)   DEFAULT 'USER',
    status        VARCHAR2(10)   DEFAULT 'PROPOSED',
    confidence    NUMBER         DEFAULT 0.5,       -- grows each time the fact is seen again
    seen_count    NUMBER         DEFAULT 1,
    use_count     NUMBER         DEFAULT 0,         -- times sent with an Ask AI question
    evidence      VARCHAR2(1000),
    instance      VARCHAR2(10),
    created_by    VARCHAR2(120),
    created_date  DATE           DEFAULT SYSDATE,
    decided_by    VARCHAR2(120),
    decided_date  DATE,
    last_used     DATE
);
CREATE UNIQUE INDEX wms_fusion_knowledge_key_ux ON wms_fusion_knowledge (fact_key);

-- ── Watchdogs: queries that run on a schedule and alert when the result is unusual ──
-- metric    : ROWS (row count of the query) | VALUE (value_column of the first row)
-- rule_type : AUTO (learns the normal range per weekday + hour: median ± k × MAD) | ABOVE | BELOW | CHANGE (%)
-- status    : NEW | LEARNING | OK | ALERT | ERROR
-- Times (last_run, next_run, run_date) are written as the users' local time by the page.
CREATE TABLE wms_fusion_watchdogs (
    watch_id       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    watch_name     VARCHAR2(200) NOT NULL,
    description    VARCHAR2(1000),                  -- note shown in the alert
    sql_text       CLOB          NOT NULL,
    instance       VARCHAR2(10)  DEFAULT 'PROD',
    metric         VARCHAR2(10)  DEFAULT 'ROWS',
    value_column   VARCHAR2(128),
    unit_label     VARCHAR2(40),
    rule_type      VARCHAR2(10)  DEFAULT 'AUTO',
    threshold      NUMBER,
    direction      VARCHAR2(5)   DEFAULT 'BOTH',    -- UP | DOWN | BOTH
    sensitivity    VARCHAR2(10)  DEFAULT 'MEDIUM',  -- LOW | MEDIUM | HIGH
    every_min      NUMBER        DEFAULT 60,
    active         VARCHAR2(1)   DEFAULT 'Y',
    notify         VARCHAR2(1)   DEFAULT 'Y',
    teams_webhook  VARCHAR2(1000),                  -- blank = AI Control setting INBOX_TEAMS_WEBHOOK
    email_to       VARCHAR2(1000),                  -- blank = AI Control setting INBOX_EMAIL_TO
    cooldown_hours NUMBER        DEFAULT 6,         -- repeat an ongoing alert after
    status         VARCHAR2(10)  DEFAULT 'NEW',
    last_value     NUMBER,
    last_message   VARCHAR2(1000),
    last_run       DATE,
    next_run       DATE,
    last_alert     DATE,
    run_count      NUMBER        DEFAULT 0,
    alert_count    NUMBER        DEFAULT 0,
    created_by     VARCHAR2(120),
    created_date   DATE          DEFAULT SYSDATE,
    changed_by     VARCHAR2(120),
    changed_date   DATE
);

CREATE TABLE wms_fusion_watch_runs (
    run_id        NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    watch_id      NUMBER NOT NULL,
    run_date      DATE,
    metric_value  NUMBER,
    expected      NUMBER,                           -- median of the baseline
    low_value     NUMBER,                           -- normal range
    high_value    NUMBER,
    status        VARCHAR2(10),
    message       VARCHAR2(1000),
    elapsed_ms    NUMBER,
    notified      VARCHAR2(1) DEFAULT 'N',
    run_by        VARCHAR2(120)
);
CREATE INDEX wms_fusion_watch_runs_ix ON wms_fusion_watch_runs (watch_id, run_date);

-- One row: the PC that runs the schedule (3-minute lease, renewed every minute while Fusion SQL is open)
CREATE TABLE wms_fusion_watch_lease (
    lease_name   VARCHAR2(30) PRIMARY KEY,
    holder       VARCHAR2(200),
    lease_until  DATE
);

-- Useful checks
-- SELECT kind, status, COUNT(*) FROM wms_fusion_knowledge GROUP BY kind, status ORDER BY 1, 2;
-- SELECT watch_name, status, last_value, last_message, next_run FROM wms_fusion_watchdogs ORDER BY status;
-- SELECT * FROM wms_fusion_watch_runs WHERE watch_id = :id ORDER BY run_date DESC;
