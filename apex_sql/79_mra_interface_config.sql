-- ============================================================================
-- 79_mra_interface_config.sql
-- MRA interface switch for the Shipping Agent's Print Trip.
--   INTERFACE_FLAG = 'Y' → Print Trip interfaces every order to MRA first and prints only what MRA accepts
--   INTERFACE_FLAG = 'N' → Print Trip prints without interfacing to MRA
-- One row per instance (PROD / TEST). The Shipping Agent creates and seeds this table itself on first use
-- (through ai/executewrite); this script is only needed to create it by hand.
-- Users switch it on WMS › MRA Interface (wms/mra-interface.js — reason required to disable, history in
-- WMS_MRA_INTERFACE_LOG). The flag shows as "MRA: Yes / No" in every Shipping Agent trip header (click = open that page).
-- ============================================================================

CREATE TABLE wms_mra_interface_config (
    instance_name   VARCHAR2(20) PRIMARY KEY,
    interface_flag  VARCHAR2(1)  DEFAULT 'Y' NOT NULL
                    CONSTRAINT wms_mra_cfg_flag_ck CHECK (interface_flag IN ('Y', 'N')),
    note            VARCHAR2(400),
    changed_by      VARCHAR2(120),
    changed_date    DATE DEFAULT SYSDATE
);

-- Every change made on WMS › MRA Interface (who, when, old → new, reason)
CREATE TABLE wms_mra_interface_log (
    log_id          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    instance_name   VARCHAR2(20) NOT NULL,
    old_flag        VARCHAR2(1),
    new_flag        VARCHAR2(1)  NOT NULL,
    note            VARCHAR2(400),
    changed_by      VARCHAR2(120),
    changed_date    DATE DEFAULT SYSDATE
);

INSERT INTO wms_mra_interface_config (instance_name, interface_flag, note, changed_by) VALUES ('PROD', 'Y', 'Default', 'SYSTEM');
INSERT INTO wms_mra_interface_config (instance_name, interface_flag, note, changed_by) VALUES ('TEST', 'Y', 'Default', 'SYSTEM');
COMMIT;

-- Check the status and the change history
SELECT * FROM wms_mra_interface_log ORDER BY log_id DESC;
SELECT instance_name, interface_flag, changed_by, changed_date FROM wms_mra_interface_config;

-- Switch MRA off / on for PROD by hand
-- UPDATE wms_mra_interface_config SET interface_flag = 'N', changed_by = 'ADMIN', changed_date = SYSDATE WHERE instance_name = 'PROD';
-- UPDATE wms_mra_interface_config SET interface_flag = 'Y', changed_by = 'ADMIN', changed_date = SYSDATE WHERE instance_name = 'PROD';
-- COMMIT;
