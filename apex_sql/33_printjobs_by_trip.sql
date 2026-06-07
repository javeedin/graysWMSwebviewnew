-- ============================================================
-- APEX REST HANDLER — GET printjobs/trip/:tripId
-- ============================================================
-- Module:       TRIPMANAGEMENT
-- URI Template: printjobs/trip/:tripId
-- Method:       GET
-- Source Type:  SQL Query
-- URI Bind:     :tripId (VARCHAR2)
-- ============================================================
-- Returns one row per order_number for the given trip.
-- If a row exists → order has been downloaded/printed.
-- print_total   = total print job records for that order
-- print_printed = how many have print_status = 'PRINTED'
-- ============================================================
SELECT
    order_number,
    trip_id,
    customer_name,
    COUNT(*)                                                          AS print_total,
    COUNT(CASE WHEN UPPER(print_status) = 'PRINTED' THEN 1 END)      AS print_printed,
    MAX(UPPER(overall_status))                                        AS overall_status,
    MAX(created_date)                                                 AS last_job_date,
    MAX(print_completed)                                              AS last_printed_date
FROM wms_print_jobs
WHERE trip_id = :tripId
GROUP BY order_number, trip_id, customer_name
ORDER BY order_number
