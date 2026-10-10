-- ============================================================
-- PINNED TRIPS + the FUTURE TRIP 999999999 (WMS › Trip Management › Pinned Trips)
-- ============================================================
-- 1) WMS_TRIP_PINS: one row per instance × trip a user pinned from the trip cards (Pin button). Shared by every PC.
--    The page creates this table itself on the first pin (wms/future-trip.js, wmsPinToggle) — run this only when
--    ai/executewrite is not available to the users.
-- 2) Trip 999999999 replaces trip 9999 as the FUTURE TRIP: orders that have no real trip yet are moved there
--    (Move dialog: it is always first in the list). The Pinned Trips tab shows them (GETTRIPDETAILS/999999999)
--    with only Move and Delete per line. The page can create the trip itself ("Set up trip 999999999": it finds the
--    trip header table from the trips/create ORDS handler and shows the INSERT before it runs). Use this script when
--    that is not possible (TRIP_ID is an identity column, or NUMBER(p) with p < 9 — widen it first). One header row only.
-- 3) Orders still on the old future trip 9999 are listed on the tab until they are moved; step 4 moves them all.
-- ============================================================

-- 1) the pins
CREATE TABLE wms_trip_pins (
    instance_name  VARCHAR2(20)  NOT NULL,
    trip_id        VARCHAR2(50)  NOT NULL,
    pinned_by      VARCHAR2(120),
    pinned_date    DATE DEFAULT SYSDATE,
    note           VARCHAR2(400),
    CONSTRAINT wms_trip_pins_pk PRIMARY KEY (instance_name, trip_id)
);

-- 2a) Which table does trips/create insert into? (the trip header table)
SELECT t.uri_template, h.method, DBMS_LOB.SUBSTR(h.source, 4000, 1) AS handler_source
FROM   user_ords_handlers h
JOIN   user_ords_templates t ON t.id = h.template_id
WHERE  LOWER(t.uri_template) LIKE 'trips/create%';

-- 2b) Its columns: TRIP_ID must not be GENERATED ALWAYS AS IDENTITY, and a NUMBER(p) needs p >= 9 for 999999999.
--     Replace WMS_TRIP_HEADER with the table found in step 2a.
SELECT column_name, data_type, data_precision, nullable, identity_column, data_default
FROM   user_tab_columns
WHERE  table_name = 'WMS_TRIP_HEADER'
ORDER  BY column_id;
-- e.g. ALTER TABLE wms_trip_header MODIFY (trip_id NUMBER(12));      -- only when TRIP_ID is NUMBER(p) with p < 9
-- e.g. ALTER TABLE wms_trip_details MODIFY (trip_id NUMBER(12));     -- same check on the trip lines table

-- 2c) Create trip 999999999 — ONE header row for every instance (adjust the table / column names to what step 2b shows).
--     The WMS handlers (trips/addorders, used by Move and Add Orders) look a trip up by trip_id alone: a second row,
--     e.g. one per instance, makes them fail with ORA-01422 "exact fetch returns more than requested number of rows".
--     The order lines (WMS_TRIP_DETAILS) carry their own INSTANCE_NAME, and GETTRIPDETAILS reads only those, so one header
--     row serves PROD and TEST. The trip date is 31-12-2099, so it never shows in a normal Fetch Trips date range.
INSERT INTO wms_trip_header (trip_id, trip_date, trip_lorry, trip_loading_bay, trip_priority, trip_status, instance_name)
SELECT 999999999, DATE '2099-12-31', 'FUTURE TRIP', 'FUTURE', 99, 'OPEN', 'PROD' FROM dual
WHERE NOT EXISTS (SELECT 1 FROM wms_trip_header WHERE trip_id = 999999999);
COMMIT;

-- 2d) Already two rows (an earlier set-up per instance)? Keep one — the PROD one when there is one — and delete the rest.
--     The Pinned Trips tab shows a red "Fix" button that runs the same statement.
DELETE FROM wms_trip_header
WHERE  trip_id = 999999999
AND    ROWID <> (SELECT MIN(ROWID) KEEP (DENSE_RANK FIRST ORDER BY CASE WHEN UPPER(instance_name) = 'PROD' THEN 0 ELSE 1 END)
                 FROM wms_trip_header WHERE trip_id = 999999999);
COMMIT;

-- 3) What is still on the old future trip 9999?
SELECT order_number, instance_name FROM wms_trip_details WHERE trip_id = 9999 ORDER BY instance_name, order_number;

-- 4) Move them all to 999999999 (optional — the Pinned Trips tab also offers Move per order).
--    Adjust the table name if the trip lines live elsewhere; the picker assignments stay with the order.
-- UPDATE wms_trip_details SET trip_id = 999999999 WHERE trip_id = 9999;
-- COMMIT;

-- 5) Check
SELECT instance_name, trip_id, pinned_by, pinned_date FROM wms_trip_pins ORDER BY pinned_date DESC;
SELECT trip_id, instance_name, COUNT(*) AS orders FROM wms_trip_details WHERE trip_id IN (999999999, 9999) GROUP BY trip_id, instance_name;
