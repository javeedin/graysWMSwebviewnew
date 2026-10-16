-- ============================================================================
-- 72_fusion_api_loads.sql — Data Loading › Fusion API tab
-- Saved field mappings per Fusion REST resource, every load run and the result of each record.
-- The page creates these tables itself (ai/executewrite) the first time they are needed;
-- this script is for DBAs who prefer to create them up front.
-- ============================================================================

CREATE TABLE wms_fapi_jobs (
    job_id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_name        VARCHAR2(200) NOT NULL,
    resource_name   VARCHAR2(100) NOT NULL,          -- e.g. suppliers, invoices, itemsV2
    api             VARCHAR2(10) DEFAULT 'fscm',      -- fscm | hcm | crm
    config_json     CLOB,                             -- method, child collection, group-by, field expressions
    created_by      VARCHAR2(120),
    created_date    DATE DEFAULT SYSDATE,
    updated_by      VARCHAR2(120),
    updated_date    DATE DEFAULT SYSDATE
);

CREATE TABLE wms_fapi_runs (
    run_id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id          NUMBER,
    resource_name   VARCHAR2(100) NOT NULL,
    api             VARCHAR2(10),
    method          VARCHAR2(10),                     -- POST (create) | PATCH (update)
    instance        VARCHAR2(10),                     -- PROD | TEST
    status          VARCHAR2(20),                     -- OK | PARTIAL | FAILED
    total_count     NUMBER,
    ok_count        NUMBER,
    error_count     NUMBER,
    source_note     VARCHAR2(400),
    config_json     CLOB,
    run_by          VARCHAR2(120),
    started_date    DATE DEFAULT SYSDATE,
    finished_date   DATE,
    elapsed_ms      NUMBER
);

CREATE TABLE wms_fapi_run_rows (
    run_id          NUMBER NOT NULL,
    rec_no          NUMBER NOT NULL,
    source_rows     VARCHAR2(400),                    -- source row numbers that made this record
    status          VARCHAR2(10),                     -- OK | ERROR
    http_status     NUMBER,
    result_key      VARCHAR2(200),                    -- id / number Fusion returned
    message         VARCHAR2(4000),                   -- Fusion's error text
    payload         CLOB,                             -- the JSON that was sent
    CONSTRAINT wms_fapi_run_rows_pk PRIMARY KEY (run_id, rec_no)
);

CREATE INDEX wms_fapi_runs_res_ix ON wms_fapi_runs (resource_name, run_id);
