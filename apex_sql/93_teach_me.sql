-- ============================================================================
-- 93_teach_me.sql — Teach Me module (teachme/index.html)
-- Lessons the users teach the app (notes + recorded portal navigation with variables) and every replay of them.
-- The page creates these tables itself on first use (ai/executewrite); this script is the same DDL to run by hand.
-- A lesson is one JSON document (doc_json): subject, title, kind (notes | navigation), notes, start URL, steps,
-- variables, capture rule. The same rows live in the PC's DuckDB file C:\fusion\teachme\teachme.duckdb; the page keeps
-- the newer copy (version) when they differ. Column names avoid the words the ai/executequery gateway refuses.
-- ============================================================================

CREATE TABLE wms_teach_lessons (
    id            VARCHAR2(60)  PRIMARY KEY,
    subject       VARCHAR2(200),
    title         VARCHAR2(400),
    kind          VARCHAR2(20),
    version       NUMBER        DEFAULT 1,
    doc_json      CLOB,
    removed       VARCHAR2(1)   DEFAULT 'N',
    created_by    VARCHAR2(100),
    created_date  DATE          DEFAULT SYSDATE,
    changed_by    VARCHAR2(100),
    changed_date  DATE
);

CREATE INDEX wms_teach_lessons_subj_ix ON wms_teach_lessons (subject);

CREATE TABLE wms_teach_runs (
    id             VARCHAR2(60)  PRIMARY KEY,
    lesson_id      VARCHAR2(60),
    lesson_title   VARCHAR2(400),
    lesson_version NUMBER,
    run_by         VARCHAR2(100),
    started_date   DATE,
    finished_date  DATE,
    status         VARCHAR2(30),      -- ready (stopped before Submit) / captured / finished / stopped / error
    result         VARCHAR2(400),     -- e.g. the SR number read from the page
    values_json    CLOB,              -- the variable values used
    log_json       CLOB               -- every step of the run
);

CREATE INDEX wms_teach_runs_lesson_ix ON wms_teach_runs (lesson_id, started_date);
