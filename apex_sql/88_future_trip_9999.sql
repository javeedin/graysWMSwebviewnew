-- ============================================================
-- Trip 9999 = the FUTURE TRIP (WMS › Trip Management › Future Trip)
-- ============================================================
-- Orders that have no real trip yet are moved to trip 9999 (Move dialog: it is always first in the list).
-- The Future Trip tab shows them (GETTRIPDETAILS/9999) with only Move and Delete per line.
--
-- The page can create the trip itself: Future Trip › "Set up trip 9999". It finds the trip header table from the
-- trips/create ORDS handler (INSERT INTO ...), fills the columns a new trip row needs and shows the INSERT before it
-- runs it through ai/executewrite. Use this script when that is not possible (e.g. TRIP_ID is an identity column).
--
-- The trip date is 31-12-2099, so trip 9999 never shows in a normal Fetch Trips date range.
-- ============================================================

-- 1) Which table does trips/create insert into? (the trip header table)
SELECT t.uri_template, h.method, DBMS_LOB.SUBSTR(h.source, 4000, 1) AS handler_source
FROM   user_ords_handlers h
JOIN   user_ords_templates t ON t.id = h.template_id
WHERE  LOWER(t.uri_template) LIKE 'trips/create%';

-- 2) Its columns (TRIP_ID must not be GENERATED ALWAYS AS IDENTITY to insert 9999)
--    Replace WMS_TRIP_HEADER with the table found in step 1.
SELECT column_name, data_type, nullable, identity_column, data_default
FROM   user_tab_columns
WHERE  table_name = 'WMS_TRIP_HEADER'
ORDER  BY column_id;

-- 3) Create trip 9999 in PROD — adjust the table / column names to what step 2 shows.
INSERT INTO wms_trip_header (trip_id, trip_date, trip_lorry, trip_loading_bay, trip_priority, trip_status, instance_name)
VALUES (9999, DATE '2099-12-31', 'FUTURE TRIP', 'FUTURE', 99, 'OPEN', 'PROD');
COMMIT;

-- 4) Check: the orders on the future trip
SELECT order_number, instance_name FROM wms_trip_details WHERE trip_id = 9999 ORDER BY order_number;
