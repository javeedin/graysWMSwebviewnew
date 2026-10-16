-- ============================================================================
-- 78_order_management.sql — Order Management module (om/index.html)
-- The page creates these tables itself on first use (ai/executewrite, one statement per call);
-- this script is the same DDL for running by hand in SQL Developer.
--
--   WMS_OM_SETTINGS   one JSON document per key: BUS (business units), GENERAL (tax rates, precision,
--                     max discount %, Fusion payload options, approvers, admins), SOURCES (where every
--                     lookup comes from: Fusion BIP report, Fusion SQL or APEX SQL), LAYOUTS (print)
--   WMS_OM_USERS      per app login: business unit, defaults, order number prefix + next number
--   WMS_OM_ORDERS     every order made in the module (header + lines as JSON, totals, verdict,
--                     Fusion header id / status, last error)
--   WMS_OM_EVENTS     the order timeline: created, saved, checks, approval asked / decided, sent to
--                     Fusion, Fusion reply, printed, e-mailed, MRA …
--   WMS_OM_APPROVALS  approval requests (discount over the limit, credit) decided by approvers
--   WMS_OM_DISCOUNTS  discount rules (replaces the SQL Server FUSION_DISCOUNTS_FILTERED_VW): context
--                     CUSTOMER / MARKETING, level, target value, %, date window, exclusions, qty band,
--                     customer number or category
--   WMS_OM_BACKORDERS lines that could not be served from stock (replaces SQL Server FUSION_BACKORDERS)
-- ============================================================================

CREATE TABLE wms_om_settings (
    setting_key    VARCHAR2(60) PRIMARY KEY,
    setting_value  CLOB,
    updated_by     VARCHAR2(120),
    updated_date   DATE DEFAULT SYSDATE
);

CREATE TABLE wms_om_users (
    app_user       VARCHAR2(120) PRIMARY KEY,
    bu_name        VARCHAR2(120),
    warehouse      VARCHAR2(120),
    subinventory   VARCHAR2(60),
    salesrep_name  VARCHAR2(200),
    salesrep_id    VARCHAR2(40),
    price_list     VARCHAR2(200),
    order_prefix   VARCHAR2(20),
    next_no        NUMBER DEFAULT 1,
    prefs_json     CLOB,
    updated_by     VARCHAR2(120),
    updated_date   DATE DEFAULT SYSDATE
);

CREATE TABLE wms_om_orders (
    order_id         NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_no         VARCHAR2(60) NOT NULL,
    bu_name          VARCHAR2(120),
    instance         VARCHAR2(10) DEFAULT 'PROD',
    status           VARCHAR2(30) DEFAULT 'DRAFT',      -- DRAFT, PENDING_APPROVAL, APPROVED, REJECTED, SUBMITTED, FUSION_DRAFT, FAILED, DISCARDED
    verdict          VARCHAR2(20),                       -- ready / approval / blocked (last live check)
    customer_number  VARCHAR2(60),
    customer_name    VARCHAR2(360),
    order_type       VARCHAR2(120),
    customer_po      VARCHAR2(120),
    order_date       DATE,
    currency         VARCHAR2(10),
    total_net        NUMBER,
    total_tax        NUMBER,
    total_disc       NUMBER,
    line_count       NUMBER,
    header_json      CLOB,
    lines_json       CLOB,
    fusion_header_id VARCHAR2(40),
    fusion_order_no  VARCHAR2(60),
    fusion_status    VARCHAR2(60),
    last_error       VARCHAR2(4000),
    created_by       VARCHAR2(120),
    created_date     DATE DEFAULT SYSDATE,
    updated_by       VARCHAR2(120),
    updated_date     DATE DEFAULT SYSDATE,
    submitted_by     VARCHAR2(120),
    submitted_date   DATE,
    CONSTRAINT wms_om_orders_uk UNIQUE (order_no, instance)
);

CREATE TABLE wms_om_events (
    event_id      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id      NUMBER NOT NULL,
    event_type    VARCHAR2(40),
    detail        VARCHAR2(4000),
    data_json     CLOB,
    created_by    VARCHAR2(120),
    created_date  DATE DEFAULT SYSDATE
);
CREATE INDEX wms_om_events_n1 ON wms_om_events (order_id);

CREATE TABLE wms_om_approvals (
    approval_id     NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id        NUMBER NOT NULL,
    order_no        VARCHAR2(60),
    reason          VARCHAR2(4000),
    amount          NUMBER,
    requested_by    VARCHAR2(120),
    requested_date  DATE DEFAULT SYSDATE,
    status          VARCHAR2(20) DEFAULT 'PENDING',     -- PENDING, APPROVED, REJECTED, CANCELLED
    decided_by      VARCHAR2(120),
    decided_date    DATE,
    note            VARCHAR2(1000)
);
CREATE INDEX wms_om_approvals_n1 ON wms_om_approvals (status);

CREATE TABLE wms_om_discounts (
    rule_id       NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ctx           VARCHAR2(20) DEFAULT 'CUSTOMER',      -- CUSTOMER / MARKETING
    disc_level    VARCHAR2(30),                         -- ITEM, GROUPCODE, SUB_CATEGORY, CATEGORY, BRAND, SUPPLIER, PROFIT_CENTER, ALL (empty = match any)
    target        VARCHAR2(200) DEFAULT 'ALL',          -- the item / brand / category … value (ITEM_CODE in the legacy view)
    pct           NUMBER DEFAULT 0,
    valid_from    DATE,
    valid_to      DATE,
    excl          VARCHAR2(1) DEFAULT 'N',              -- Y = item excluded from discounts
    disc_ref      VARCHAR2(200),                        -- discount reference (EBS_DISCOUNT_REF)
    cust_no       VARCHAR2(60),
    cust_cat      VARCHAR2(120),
    min_qty       NUMBER,
    max_qty       NUMBER,
    active        VARCHAR2(1) DEFAULT 'Y',
    source        VARCHAR2(20) DEFAULT 'MANUAL',        -- MANUAL / IMPORT / FUSION
    updated_by    VARCHAR2(120),
    updated_date  DATE DEFAULT SYSDATE
);
CREATE INDEX wms_om_discounts_n1 ON wms_om_discounts (cust_no);
CREATE INDEX wms_om_discounts_n2 ON wms_om_discounts (cust_cat);

CREATE TABLE wms_om_backorders (
    backorder_id    NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_no        VARCHAR2(60),
    customer_number VARCHAR2(60),
    customer_name   VARCHAR2(360),
    item            VARCHAR2(100),
    item_desc       VARCHAR2(400),
    qty             NUMBER,
    warehouse       VARCHAR2(120),
    status          VARCHAR2(20) DEFAULT 'OPEN',        -- OPEN / SERVED / CANCELLED
    created_by      VARCHAR2(120),
    created_date    DATE DEFAULT SYSDATE
);
