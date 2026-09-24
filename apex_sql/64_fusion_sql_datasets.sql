-- ============================================================
-- 64 — FUSION SQL: DATASETS (query results saved as APEX tables)
-- ============================================================
-- "Save to APEX" in the Fusion SQL workbench (fusionsql/index.html)
-- stores a Fusion query's result as a table in this schema, together
-- with the source SQL and its parameter values, so the table can be
-- refreshed later by re-running the same query on Fusion.
--
--   wms_fusion_sql_datasets  — registry: one row per saved dataset
--   FSQ_<NAME>               — one data table per dataset, created by the
--                              page from the result columns:
--                                FSQ_LOAD_ID    NUMBER  (which load/refresh)
--                                FSQ_LOADED_AT  DATE    (when it was loaded)
--                                <result columns> NUMBER | VARCHAR2(4000)
--
-- Refresh is load-safe: new rows are inserted under a new FSQ_LOAD_ID and
-- the previous load is deleted only after every new row is in (REPLACE
-- mode). APPEND mode keeps every load as history. If a refresh fails, the
-- partial new load is removed and the old data stays.
--
-- Everything goes through the existing guarded gateways (ai/executequery +
-- ai/executewrite); the page creates this registry itself on first use,
-- so running this script is optional.
--
-- Run once in the WKSP_GRAYSAPP parsing schema.
-- ============================================================

DECLARE
    v_exists NUMBER;
BEGIN
    SELECT COUNT(*) INTO v_exists FROM user_tables WHERE table_name = 'WMS_FUSION_SQL_DATASETS';
    IF v_exists = 0 THEN
        EXECUTE IMMEDIATE q'[
            CREATE TABLE wms_fusion_sql_datasets (
                dataset_id       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                dataset_name     VARCHAR2(200)  NOT NULL,
                table_name       VARCHAR2(128)  NOT NULL,
                description      VARCHAR2(1000),
                source_sql       CLOB           NOT NULL,   -- Fusion SQL, with {{PARAM}} / :BIND placeholders
                param_json       VARCHAR2(4000),            -- parameter values used on refresh
                row_limit        NUMBER,
                refresh_mode     VARCHAR2(10)   DEFAULT 'REPLACE',   -- REPLACE | APPEND
                current_load_id  NUMBER         DEFAULT 0,
                row_count        NUMBER,
                column_count     NUMBER,
                instance         VARCHAR2(10),              -- Fusion pod the data came from
                created_by       VARCHAR2(120),
                created_date     DATE           DEFAULT SYSDATE,
                refreshed_by     VARCHAR2(120),
                refreshed_date   DATE,
                last_status      VARCHAR2(10),              -- RUNNING | OK | ERROR
                last_error       VARCHAR2(4000),
                last_ms          NUMBER
            )
        ]';
        EXECUTE IMMEDIATE 'CREATE UNIQUE INDEX wms_fusion_sql_datasets_name_ux ON wms_fusion_sql_datasets (UPPER(dataset_name))';
        EXECUTE IMMEDIATE 'CREATE UNIQUE INDEX wms_fusion_sql_datasets_tab_ux ON wms_fusion_sql_datasets (table_name)';
    END IF;
END;
/

-- ------------------------------------------------------------
-- Checks
-- ------------------------------------------------------------
-- SELECT dataset_name, table_name, refresh_mode, row_count, current_load_id,
--        last_status, refreshed_by, refreshed_date
-- FROM   wms_fusion_sql_datasets
-- ORDER  BY NVL(refreshed_date, created_date) DESC;
--
-- A saved dataset is an ordinary table, e.g.:
-- SELECT * FROM fsq_sales_orders_sep;
