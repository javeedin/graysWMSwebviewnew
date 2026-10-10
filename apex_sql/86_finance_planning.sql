-- Finance Lens › Planning (finance/fin-plan.js): budget / forecast / scenario versions shared by every PC.
-- Created by the page on first use (FL.apexStore.planEnsure in finance/fin-store.js); this script is the same DDL for a DBA.
-- The same versions are kept in each PC's finance DuckDB file (fin_plan_versions / fin_plan_lines / fin_plan_amounts).
-- Nothing is sent to Oracle Fusion GL.

CREATE TABLE wms_fin_plan_versions (
    version_id     VARCHAR2(60) NOT NULL,
    name           VARCHAR2(200),
    kind           VARCHAR2(20),          -- BUDGET | FORECAST | SCENARIO
    fiscal_year    NUMBER,
    ledger_code    VARCHAR2(100),
    currency       VARCHAR2(15),
    status         VARCHAR2(20),          -- DRAFT | SUBMITTED | APPROVED | REJECTED
    rev            NUMBER,                -- +1 on every save: the newer copy (APEX or a PC) wins
    actual_through NUMBER,                -- rolling forecast: months up to this period_seq are actuals
    lines_count    NUMBER,
    total_revenue  NUMBER,
    total_profit   NUMBER,
    meta_json      CLOB,                  -- periods, companies, grain, drivers, targets, notes, workflow
    created_by     VARCHAR2(100),
    created_at     DATE DEFAULT SYSDATE,
    changed_by     VARCHAR2(100),
    changed_at     DATE DEFAULT SYSDATE,
    submitted_by   VARCHAR2(100),
    submitted_at   DATE,
    approved_by    VARCHAR2(100),
    approved_at    DATE,
    CONSTRAINT wms_fin_plan_versions_pk PRIMARY KEY (version_id)
);

CREATE TABLE wms_fin_plan_lines (
    version_id  VARCHAR2(60) NOT NULL,
    line_no     NUMBER,
    company     VARCHAR2(150),
    cost_centre VARCHAR2(150),            -- '-' when the version is by company × account
    account     VARCHAR2(150) NOT NULL,
    method      VARCHAR2(30),             -- py | runrate | annual | growth | driver | pctof | trend | manual | zero
    rule_json   VARCHAR2(2000),
    adj         NUMBER,                   -- goal-seek factor on top of the rule
    note        VARCHAR2(1000),
    total       NUMBER,
    amounts     VARCHAR2(4000)            -- JSON array, one amount per period, debit − credit
);

CREATE TABLE wms_fin_plan_events (
    version_id  VARCHAR2(60) NOT NULL,
    event_at    DATE DEFAULT SYSDATE,
    event_by    VARCHAR2(100),
    event       VARCHAR2(30),             -- created | saved | submitted | approved | rejected | reopened | budget
    status_from VARCHAR2(20),
    status_to   VARCHAR2(20),
    rev         NUMBER,
    note        VARCHAR2(2000)
);
