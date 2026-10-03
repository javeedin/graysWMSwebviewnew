-- ============================================================================
-- 85_finance_lens_fusion.sql — Finance Lens: the Oracle Fusion chart of accounts, discovered once and kept
-- The Finance Lens page (finance/fin-store.js) creates these tables itself on first use; this script is the reference.
--   WMS_FIN_DISCOVERY     one row per pod ('PROD', 'TEST', 'LOGGED-IN'): the whole discovery as JSON (DISC_JSON) (ledgers, COA
--                         segments with qualifiers and measured purity, roles and why, calendars, budgets) so the Data tab
--                         restores it on any PC without asking Fusion again
--   WMS_FIN_COA_SEGMENTS  one row per pod x chart of accounts x segment column; ROLE = COMPANY (balancing) /
--                         COST_CENTRE / ACCOUNT (natural account) / INTERCOMPANY / NULL — the roles chosen for the load win
--   WMS_FIN_LEDGERS       one row per pod x ledger; SELECTED = 'Y' for the ledgers loaded into Finance Lens
-- The same discovery is written to the finance DuckDB file (fin_fusion_discovery, fin_coa_segments, fin_ledgers).
-- ============================================================================
CREATE TABLE wms_fin_discovery (
    pod            VARCHAR2(20) NOT NULL,
    discovered_at  DATE DEFAULT SYSDATE,
    discovered_by  VARCHAR2(100),
    ledgers        NUMBER,
    charts         NUMBER,
    disc_json      CLOB,
    CONSTRAINT wms_fin_discovery_pk PRIMARY KEY (pod)
);

CREATE TABLE wms_fin_coa_segments (
    pod             VARCHAR2(20) NOT NULL,
    coa_id          VARCHAR2(30) NOT NULL,
    column_name     VARCHAR2(30) NOT NULL,
    segment_name    VARCHAR2(200),
    segment_num     NUMBER,
    value_set_id    VARCHAR2(40),
    qualifiers      VARCHAR2(400),
    distinct_values NUMBER,
    purity          NUMBER,
    role            VARCHAR2(30),
    evidence        VARCHAR2(1000),
    discovered_at   DATE DEFAULT SYSDATE,
    discovered_by   VARCHAR2(100),
    CONSTRAINT wms_fin_coa_segments_pk PRIMARY KEY (pod, coa_id, column_name)
);

CREATE TABLE wms_fin_ledgers (
    pod            VARCHAR2(20) NOT NULL,
    ledger_id      NUMBER NOT NULL,
    ledger_name    VARCHAR2(200),
    short_name     VARCHAR2(100),
    currency       VARCHAR2(15),
    coa_id         VARCHAR2(30),
    period_set     VARCHAR2(100),
    period_type    VARCHAR2(60),
    category       VARCHAR2(60),
    bal_seg_column VARCHAR2(30),
    companies      VARCHAR2(4000),
    selected       CHAR(1) DEFAULT 'N',
    discovered_at  DATE DEFAULT SYSDATE,
    discovered_by  VARCHAR2(100),
    CONSTRAINT wms_fin_ledgers_pk PRIMARY KEY (pod, ledger_id)
);

-- Which segment is what, per pod:
-- SELECT pod, coa_id, column_name, segment_name, role, ROUND(purity * 100) purity_pct, evidence
--   FROM wms_fin_coa_segments ORDER BY pod, coa_id, segment_num;
