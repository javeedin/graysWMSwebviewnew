-- ============================================================
-- WMS AI DIGITAL EMPLOYEE - TRIAL PERIOD
-- ============================================================
-- One global trial window for the AI Digital Employee pilot.
-- The module reads this row on load (through the ai/executequery
-- gateway) and locks itself with "Trial period ended" after
-- TRIAL_END. Run in SQL Workshop > SQL Commands.
--
-- Extend the trial later with:
--   UPDATE wms_ai_trial SET trial_end = TRUNC(SYSDATE) + 14;  COMMIT;
-- End it immediately with:
--   UPDATE wms_ai_trial SET trial_end = SYSDATE - 1;  COMMIT;
-- Disable the gate entirely (unlimited use) with:
--   UPDATE wms_ai_trial SET active = 'N';  COMMIT;
-- ============================================================

CREATE TABLE wms_ai_trial (
    id           NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    trial_start  DATE         DEFAULT SYSDATE NOT NULL,
    trial_end    DATE         NOT NULL,
    active       VARCHAR2(1)  DEFAULT 'Y' NOT NULL,   -- Y = gate enforced
    message      VARCHAR2(400),
    created_by   VARCHAR2(100) DEFAULT USER,
    created_on   DATE          DEFAULT SYSDATE
);

-- Two-week trial starting today
INSERT INTO wms_ai_trial (trial_start, trial_end, active, message)
VALUES (TRUNC(SYSDATE), TRUNC(SYSDATE) + 14, 'Y',
        'The AI Digital Employee trial has ended. Please contact the administrator to continue using it.');

COMMIT;
