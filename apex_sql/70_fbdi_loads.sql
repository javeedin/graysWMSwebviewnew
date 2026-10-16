-- ================================================================
-- 70_fbdi_loads.sql — Data Loading › Prepare & Load (Oracle Fusion FBDI)
-- ================================================================
-- A "load" prepares one FBDI template (e.g. Journals, Payables Invoices,
-- Inventory Transactions) from real data:
--   WMS_FBDI_LOADS      load definition: template, source (file / paste / APEX SQL / Fusion SQL), options
--   WMS_FBDI_LOAD_MAPS  one row per mapped template column: sheet (CSV), position, mapping expression
--   WMS_FBDI_LOAD_ROWS  the staged source rows for file / paste sources (JSON array per row)
--   WMS_FBDI_LOAD_RUNS  every check / generate: counts, status, errors summary, ZIP name
--   WMS_FBDI_RUN_FILES  the exact CSV files put in each generated ZIP (so a ZIP can be rebuilt)
-- The Data Loading page creates these tables itself on first use through
-- ai/executewrite; this script is the same DDL for running by hand.
-- ================================================================

CREATE TABLE wms_fbdi_loads (
    load_id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    load_name        VARCHAR2(200)  NOT NULL,
    template_file    VARCHAR2(100)  NOT NULL,          -- e.g. JournalImportTemplate
    description      VARCHAR2(1000),
    source_type      VARCHAR2(20)   DEFAULT 'FILE',    -- FILE | PASTE | APEX_SQL | FUSION_SQL
    source_sql       CLOB,
    source_note      VARCHAR2(400),                    -- file name / sheet / header row
    source_cols      CLOB,                             -- JSON array of source column names
    options_json     CLOB,                             -- JSON: document key, sheet row modes, checks
    instance         VARCHAR2(10)   DEFAULT 'PROD',
    status           VARCHAR2(20)   DEFAULT 'DRAFT',   -- DRAFT | CHECKED | GENERATED
    row_count        NUMBER,
    last_run_id      NUMBER,
    last_run_status  VARCHAR2(20),
    last_run_date    DATE,
    created_by       VARCHAR2(120),
    created_date     DATE DEFAULT SYSDATE,
    updated_by       VARCHAR2(120),
    updated_date     DATE DEFAULT SYSDATE
);

CREATE TABLE wms_fbdi_load_maps (
    load_id          NUMBER         NOT NULL,
    sheet_csv        VARCHAR2(60)   NOT NULL,          -- CSV name, e.g. ApInvoiceLinesInterface
    col_pos          NUMBER         NOT NULL,          -- 1-based position in the CSV
    col_label        VARCHAR2(200),
    db_column        VARCHAR2(60),
    map_expr         VARCHAR2(4000),                   -- {Source Col|filter} text, constants, {#doc} …
    updated_date     DATE DEFAULT SYSDATE,
    CONSTRAINT wms_fbdi_load_maps_pk PRIMARY KEY (load_id, sheet_csv, col_pos)
);

CREATE TABLE wms_fbdi_load_rows (
    load_id          NUMBER         NOT NULL,
    row_no           NUMBER         NOT NULL,
    row_data         CLOB,                             -- JSON array, same order as source_cols
    CONSTRAINT wms_fbdi_load_rows_pk PRIMARY KEY (load_id, row_no)
);

CREATE TABLE wms_fbdi_load_runs (
    run_id           NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    load_id          NUMBER         NOT NULL,
    template_file    VARCHAR2(100),
    release          VARCHAR2(5),                      -- Oracle release the template follows, e.g. 26C
    run_type         VARCHAR2(20),                     -- CHECK | GENERATE
    status           VARCHAR2(20),                     -- PASSED | WARNINGS | FAILED | GENERATED
    source_rows      NUMBER,
    output_rows      NUMBER,
    error_count      NUMBER,
    warning_count    NUMBER,
    zip_name         VARCHAR2(200),
    zip_bytes        NUMBER,
    summary_json     CLOB,                             -- per-sheet counts, checks, first 300 issues
    fusion_request_id NUMBER,                          -- next phase: ESS request of the import
    fusion_status    VARCHAR2(30),
    run_by           VARCHAR2(120),
    run_date         DATE DEFAULT SYSDATE
);

CREATE TABLE wms_fbdi_run_files (
    run_id           NUMBER         NOT NULL,
    csv_name         VARCHAR2(100)  NOT NULL,          -- e.g. GlInterface.csv
    row_count        NUMBER,
    byte_count       NUMBER,
    content          CLOB,
    CONSTRAINT wms_fbdi_run_files_pk PRIMARY KEY (run_id, csv_name)
);

CREATE INDEX wms_fbdi_load_runs_n1 ON wms_fbdi_load_runs (load_id, run_id);

-- Check
SELECT table_name FROM user_tables WHERE table_name LIKE 'WMS\_FBDI%' ESCAPE '\' ORDER BY table_name;
