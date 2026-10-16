-- ============================================================================
-- 82  AI Hub — eval results (created by the AI Hub page on first use; this script is for reference / manual setup)
--     One row per (question × model) of an eval run: the model's SQL and the verdict after both its SQL and the
--     verified SQL ran on Fusion. Questions come from WMS_FUSION_KNOWLEDGE (kind EXAMPLE, status APPROVED).
--     verdict: MATCH (same rows) | ROWS (same row count, other values) | WRONG | ERROR | NO_SQL
-- ============================================================================
CREATE TABLE wms_aihub_evals (
    eval_id       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_key       VARCHAR2(40) NOT NULL,
    run_date      DATE DEFAULT SYSDATE,
    run_by        VARCHAR2(120),
    instance      VARCHAR2(10),
    fact_id       NUMBER,
    question      VARCHAR2(2000),
    provider      VARCHAR2(40),
    model         VARCHAR2(200),
    verdict       VARCHAR2(20),
    ms            NUMBER,
    cost          NUMBER,
    rows_expected NUMBER,
    rows_got      NUMBER,
    sql_text      VARCHAR2(4000),
    error_text    VARCHAR2(1000)
);
CREATE INDEX wms_aihub_evals_run_ix ON wms_aihub_evals (run_key);
