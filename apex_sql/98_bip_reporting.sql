-- ============================================================
-- Oracle BIP Reporting (bip/) — what the desktop keeps in APEX
-- ============================================================
-- The page creates these tables itself on first use (BIPS.ensure in
-- bip/bip-store.js); this script is the same DDL for a DBA. Runs of a
-- report live on the PC that ran them (%LOCALAPPDATA%\GraysWMS\Bip\runs);
-- APEX holds what is shared: dashboards, favourites, notes per report
-- and a small log of every run (who ran which report, how long, how
-- many rows) so "Popular reports" and "Recent" work on every PC.
-- ============================================================

-- Dashboards: cards of reports with their parameter values, buckets and
-- how the card shows the result (number / table / chart / pivot).
CREATE TABLE wms_bip_dashboards (
    dash_id       VARCHAR2(40) PRIMARY KEY,
    name          VARCHAR2(200),
    owner         VARCHAR2(100),
    shared        VARCHAR2(1) DEFAULT 'Y',
    pod           VARCHAR2(20),
    def_json      CLOB,
    created_date  DATE DEFAULT SYSDATE,
    changed_by    VARCHAR2(100),
    changed_date  DATE
);

-- Favourite reports per app login and pod.
CREATE TABLE wms_bip_favorites (
    username      VARCHAR2(100),
    pod           VARCHAR2(20),
    report_path   VARCHAR2(1000),
    display_name  VARCHAR2(400),
    added_date    DATE DEFAULT SYSDATE,
    PRIMARY KEY (username, pod, report_path)
);

-- Notes and tags a team keeps about a report (what it is for, which parameters matter).
CREATE TABLE wms_bip_report_notes (
    pod           VARCHAR2(20),
    report_path   VARCHAR2(1000),
    notes         VARCHAR2(4000),
    tags          VARCHAR2(400),
    changed_by    VARCHAR2(100),
    changed_date  DATE,
    PRIMARY KEY (pod, report_path)
);

-- One row per run from any PC (the output itself stays on that PC).
CREATE TABLE wms_bip_run_log (
    log_id        VARCHAR2(40) PRIMARY KEY,
    pod           VARCHAR2(20),
    report_path   VARCHAR2(1000),
    display_name  VARCHAR2(400),
    app_user      VARCHAR2(100),
    pc_name       VARCHAR2(100),
    run_id        VARCHAR2(60),
    format        VARCHAR2(20),
    buckets       NUMBER,
    rows_n        NUMBER,
    bytes_n       NUMBER,
    ms            NUMBER,
    status        VARCHAR2(20),
    error_text    VARCHAR2(2000),
    params_json   VARCHAR2(4000),
    run_date      DATE DEFAULT SYSDATE
);

CREATE INDEX wms_bip_run_log_ix ON wms_bip_run_log (pod, run_date);

-- ── The catalog, shared ─────────────────────────────────────────────────────
-- Every folder a user reads and every index walk of the BI Publisher catalog is written here by the page, so another
-- user's first open of the same folder (and the search box) is instant: this PC's DuckDB copy is asked first, APEX
-- second, Fusion last (Refresh reads Fusion again and updates both). The page creates these tables on first use too.
CREATE TABLE wms_bip_catalog (
    pod           VARCHAR2(20),
    item_path     VARCHAR2(1000),
    display_name  VARCHAR2(400),
    file_name     VARCHAR2(400),
    item_type     VARCHAR2(40),
    parent_path   VARCHAR2(1000),
    last_modified VARCHAR2(40),
    owner_name    VARCHAR2(200),
    read_by       VARCHAR2(100),
    read_date     DATE DEFAULT SYSDATE,
    PRIMARY KEY (pod, item_path)
);

CREATE INDEX wms_bip_catalog_ix ON wms_bip_catalog (pod, parent_path);

CREATE TABLE wms_bip_catalog_log (
    pod       VARCHAR2(20),
    root_path VARCHAR2(1000),
    folders   NUMBER,
    reports   NUMBER,
    items     NUMBER,
    ms        NUMBER,
    read_by   VARCHAR2(100),
    read_date DATE DEFAULT SYSDATE,
    index_mode VARCHAR2(10)              -- FULL = the whole walk, UPDATE = only what changed since the last index
);
