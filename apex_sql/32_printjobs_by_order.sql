-- ============================================================
-- APEX REST HANDLER — GET printjobs/order/:orderNumber
-- ============================================================
-- Module:       TRIPMANAGEMENT
-- URI Template: printjobs/order/:orderNumber
-- Method:       GET
-- Source Type:  SQL Query
-- URI Bind:     :orderNumber (VARCHAR2)
-- ============================================================
-- Returns all print jobs for a given order number.
-- Used by shipping-agent.js saFetchOrderStatus() to show
-- Printing column: how many jobs exist and how many are Printed.
-- ============================================================
SELECT
    print_job_id,
    order_number,
    trip_id,
    trip_date,
    customer_name,
    account_number,
    download_status,
    print_status,
    overall_status,
    file_path,
    file_size_bytes,
    download_started,
    download_completed,
    print_started,
    print_completed,
    created_date
FROM wms_print_jobs
WHERE order_number = :orderNumber
ORDER BY created_date DESC
