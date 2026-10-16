-- ============================================================
-- 63 — FUSION SQL: SAVED QUERY LIBRARY
-- ============================================================
-- Saved queries of the Fusion SQL workbench (fusionsql/index.html),
-- stored in the APEX database so the whole team shares one library.
--
-- The page reads/writes this table through the existing guarded
-- gateways (ai/executequery + ai/executewrite) — no new ORDS endpoints.
-- It also creates the table itself on first use (same DDL, via
-- ai/executewrite), so running this script is optional; use it to
-- pre-create the table or to check the definition.
--
-- Query text is read back as TO_CHAR(SUBSTR(sql_text, n, 1300)) pieces,
-- so it works with both the 35c and the CLOB-safe 35d query gateway.
--
-- Run once in the WKSP_GRAYSAPP parsing schema.
-- ============================================================

DECLARE
    v_exists NUMBER;
BEGIN
    SELECT COUNT(*) INTO v_exists FROM user_tables WHERE table_name = 'WMS_FUSION_SQL_QUERIES';
    IF v_exists = 0 THEN
        EXECUTE IMMEDIATE q'[
            CREATE TABLE wms_fusion_sql_queries (
                query_id        NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                query_name      VARCHAR2(200)  NOT NULL,
                tag             VARCHAR2(60),
                description     VARCHAR2(1000),
                sql_text        CLOB           NOT NULL,
                sql_length      NUMBER,
                instance        VARCHAR2(10)   DEFAULT 'PROD',     -- pod the query was written for
                run_count       NUMBER         DEFAULT 0,
                last_run_date   DATE,
                last_row_count  NUMBER,
                created_by      VARCHAR2(120),
                created_date    DATE           DEFAULT SYSDATE,
                updated_by      VARCHAR2(120),
                updated_date    DATE
            )
        ]';
        -- "Saving with an existing name updates it" — names are unique, case-insensitive
        EXECUTE IMMEDIATE 'CREATE UNIQUE INDEX wms_fusion_sql_queries_name_ux ON wms_fusion_sql_queries (UPPER(query_name))';
    END IF;
END;
/

-- ------------------------------------------------------------
-- Checks
-- ------------------------------------------------------------
-- SELECT query_id, query_name, tag, sql_length, run_count, created_by, updated_date
-- FROM   wms_fusion_sql_queries
-- ORDER  BY NVL(updated_date, created_date) DESC;
