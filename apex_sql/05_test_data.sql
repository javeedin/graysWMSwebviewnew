-- ========================================
-- WMS TRIP MANAGEMENT - TEST DATA
-- ========================================
-- Created: 2025-11-05
-- Purpose: Insert test data for development and testing
-- ========================================

-- ========================================
-- CLEAN UP EXISTING TEST DATA (OPTIONAL)
-- ========================================
/*
-- Uncomment to delete all existing data:
DELETE FROM wms_print_job_history;
DELETE FROM wms_print_jobs;
DELETE FROM wms_trip_config;
DELETE FROM wms_printer_config;
COMMIT;
*/

-- ========================================
-- 1. INSERT TEST PRINTER CONFIGURATIONS
-- ========================================
INSERT INTO wms_printer_config (
    printer_name, paper_size, orientation,
    fusion_instance, fusion_username, fusion_password,
    auto_download, auto_print, is_active
) VALUES (
    'Microsoft Print to PDF', 'A4', 'Portrait',
    'TEST', 'shaik', 'fusion1234',
    'Y', 'Y', 'Y'
);

INSERT INTO wms_printer_config (
    printer_name, paper_size, orientation,
    fusion_instance, fusion_username, fusion_password,
    auto_download, auto_print, is_active
) VALUES (
    'HP LaserJet Pro', 'Letter', 'Portrait',
    'PROD', 'admin', 'prod_password',
    'Y', 'N', 'N'
);

COMMIT;

-- ========================================
-- 2. INSERT TEST TRIP CONFIGURATIONS
-- ========================================
DECLARE
    v_trip_config_id NUMBER;
BEGIN
    -- Trip 1: Completed trip
    INSERT INTO wms_trip_config (
        trip_id, trip_date, auto_print_enabled,
        total_orders, downloaded_orders, printed_orders, failed_orders,
        enabled_by, enabled_date
    ) VALUES (
        'TRIP001', TO_DATE('2025-11-01', 'YYYY-MM-DD'), 'Y',
        5, 5, 5, 0,
        'ADMIN', SYSDATE - 4
    ) RETURNING trip_config_id INTO v_trip_config_id;

    -- Insert print jobs for Trip 1
    INSERT INTO wms_print_jobs (
        trip_config_id, order_number, trip_id, trip_date,
        customer_name, account_number, order_date,
        download_status, print_status, overall_status,
        file_path, file_size_bytes,
        download_started, download_completed,
        print_started, print_completed
    ) VALUES (
        v_trip_config_id, 'ORD001', 'TRIP001', TO_DATE('2025-11-01', 'YYYY-MM-DD'),
        'ABC Company', 'ACC001', TO_DATE('2025-11-01', 'YYYY-MM-DD'),
        'Completed', 'Printed', 'Completed',
        'C:\WMS\PDFs\TRIP001\ORD001.pdf', 102400,
        SYSDATE - 4, SYSDATE - 4,
        SYSDATE - 4, SYSDATE - 4
    );

    INSERT INTO wms_print_jobs (
        trip_config_id, order_number, trip_id, trip_date,
        customer_name, account_number, order_date,
        download_status, print_status, overall_status,
        file_path, file_size_bytes,
        download_started, download_completed,
        print_started, print_completed
    ) VALUES (
        v_trip_config_id, 'ORD002', 'TRIP001', TO_DATE('2025-11-01', 'YYYY-MM-DD'),
        'XYZ Corporation', 'ACC002', TO_DATE('2025-11-01', 'YYYY-MM-DD'),
        'Completed', 'Printed', 'Completed',
        'C:\WMS\PDFs\TRIP001\ORD002.pdf', 98304,
        SYSDATE - 4, SYSDATE - 4,
        SYSDATE - 4, SYSDATE - 4
    );

    INSERT INTO wms_print_jobs (
        trip_config_id, order_number, trip_id, trip_date,
        customer_name, account_number, order_date,
        download_status, print_status, overall_status,
        file_path, file_size_bytes,
        download_started, download_completed,
        print_started, print_completed
    ) VALUES (
        v_trip_config_id, 'ORD003', 'TRIP001', TO_DATE('2025-11-01', 'YYYY-MM-DD'),
        'Global Traders Ltd', 'ACC003', TO_DATE('2025-11-01', 'YYYY-MM-DD'),
        'Completed', 'Printed', 'Completed',
        'C:\WMS\PDFs\TRIP001\ORD003.pdf', 115200,
        SYSDATE - 4, SYSDATE - 4,
        SYSDATE - 4, SYSDATE - 4
    );

    INSERT INTO wms_print_jobs (
        trip_config_id, order_number, trip_id, trip_date,
        customer_name, account_number, order_date,
        download_status, print_status, overall_status,
        file_path, file_size_bytes,
        download_started, download_completed,
        print_started, print_completed
    ) VALUES (
        v_trip_config_id, 'ORD004', 'TRIP001', TO_DATE('2025-11-01', 'YYYY-MM-DD'),
        'Metro Supplies', 'ACC004', TO_DATE('2025-11-01', 'YYYY-MM-DD'),
        'Completed', 'Printed', 'Completed',
        'C:\WMS\PDFs\TRIP001\ORD004.pdf', 87040,
        SYSDATE - 4, SYSDATE - 4,
        SYSDATE - 4, SYSDATE - 4
    );

    INSERT INTO wms_print_jobs (
        trip_config_id, order_number, trip_id, trip_date,
        customer_name, account_number, order_date,
        download_status, print_status, overall_status,
        file_path, file_size_bytes,
        download_started, download_completed,
        print_started, print_completed
    ) VALUES (
        v_trip_config_id, 'ORD005', 'TRIP001', TO_DATE('2025-11-01', 'YYYY-MM-DD'),
        'Tech Solutions Inc', 'ACC005', TO_DATE('2025-11-01', 'YYYY-MM-DD'),
        'Completed', 'Printed', 'Completed',
        'C:\WMS\PDFs\TRIP001\ORD005.pdf', 125000,
        SYSDATE - 4, SYSDATE - 4,
        SYSDATE - 4, SYSDATE - 4
    );

    -- Trip 2: In Progress trip with some failures
    INSERT INTO wms_trip_config (
        trip_id, trip_date, auto_print_enabled,
        total_orders, downloaded_orders, printed_orders, failed_orders,
        enabled_by, enabled_date
    ) VALUES (
        'TRIP002', TO_DATE('2025-11-04', 'YYYY-MM-DD'), 'Y',
        8, 5, 3, 2,
        'ADMIN', SYSDATE - 1
    ) RETURNING trip_config_id INTO v_trip_config_id;

    -- Jobs for Trip 2
    INSERT INTO wms_print_jobs (
        trip_config_id, order_number, trip_id, trip_date,
        customer_name, account_number, order_date,
        download_status, print_status, overall_status,
        file_path, file_size_bytes
    ) VALUES (
        v_trip_config_id, 'ORD101', 'TRIP002', TO_DATE('2025-11-04', 'YYYY-MM-DD'),
        'Fast Delivery Co', 'ACC101', TO_DATE('2025-11-04', 'YYYY-MM-DD'),
        'Completed', 'Printed', 'Completed',
        'C:\WMS\PDFs\TRIP002\ORD101.pdf', 95000
    );

    INSERT INTO wms_print_jobs (
        trip_config_id, order_number, trip_id, trip_date,
        customer_name, account_number, order_date,
        download_status, print_status, overall_status,
        file_path
    ) VALUES (
        v_trip_config_id, 'ORD102', 'TRIP002', TO_DATE('2025-11-04', 'YYYY-MM-DD'),
        'Quick Transport', 'ACC102', TO_DATE('2025-11-04', 'YYYY-MM-DD'),
        'Completed', 'Pending', 'Downloaded',
        'C:\WMS\PDFs\TRIP002\ORD102.pdf'
    );

    INSERT INTO wms_print_jobs (
        trip_config_id, order_number, trip_id, trip_date,
        customer_name, account_number, order_date,
        download_status, print_status, overall_status,
        error_message, retry_count
    ) VALUES (
        v_trip_config_id, 'ORD103', 'TRIP002', TO_DATE('2025-11-04', 'YYYY-MM-DD'),
        'Express Logistics', 'ACC103', TO_DATE('2025-11-04', 'YYYY-MM-DD'),
        'Failed', 'Pending', 'Failed',
        'Connection timeout to Fusion server', 2
    );

    INSERT INTO wms_print_jobs (
        trip_config_id, order_number, trip_id, trip_date,
        customer_name, account_number, order_date,
        download_status, print_status, overall_status
    ) VALUES (
        v_trip_config_id, 'ORD104', 'TRIP002', TO_DATE('2025-11-04', 'YYYY-MM-DD'),
        'Premium Movers', 'ACC104', TO_DATE('2025-11-04', 'YYYY-MM-DD'),
        'Pending', 'Pending', 'Pending'
    );

    INSERT INTO wms_print_jobs (
        trip_config_id, order_number, trip_id, trip_date,
        customer_name, account_number, order_date,
        download_status, print_status, overall_status,
        file_path
    ) VALUES (
        v_trip_config_id, 'ORD105', 'TRIP002', TO_DATE('2025-11-04', 'YYYY-MM-DD'),
        'Speedy Couriers', 'ACC105', TO_DATE('2025-11-04', 'YYYY-MM-DD'),
        'Completed', 'Printed', 'Completed',
        'C:\WMS\PDFs\TRIP002\ORD105.pdf'
    );

    INSERT INTO wms_print_jobs (
        trip_config_id, order_number, trip_id, trip_date,
        customer_name, account_number, order_date,
        download_status, print_status, overall_status,
        file_path
    ) VALUES (
        v_trip_config_id, 'ORD106', 'TRIP002', TO_DATE('2025-11-04', 'YYYY-MM-DD'),
        'Reliable Transport', 'ACC106', TO_DATE('2025-11-04', 'YYYY-MM-DD'),
        'Completed', 'Printing', 'Printing',
        'C:\WMS\PDFs\TRIP002\ORD106.pdf'
    );

    INSERT INTO wms_print_jobs (
        trip_config_id, order_number, trip_id, trip_date,
        customer_name, account_number, order_date,
        download_status, print_status, overall_status,
        file_path
    ) VALUES (
        v_trip_config_id, 'ORD107', 'TRIP002', TO_DATE('2025-11-04', 'YYYY-MM-DD'),
        'Smart Delivery', 'ACC107', TO_DATE('2025-11-04', 'YYYY-MM-DD'),
        'Completed', 'Printed', 'Completed',
        'C:\WMS\PDFs\TRIP002\ORD107.pdf'
    );

    INSERT INTO wms_print_jobs (
        trip_config_id, order_number, trip_id, trip_date,
        customer_name, account_number, order_date,
        download_status, print_status, overall_status,
        error_message, retry_count
    ) VALUES (
        v_trip_config_id, 'ORD108', 'TRIP002', TO_DATE('2025-11-04', 'YYYY-MM-DD'),
        'ProShip Services', 'ACC108', TO_DATE('2025-11-04', 'YYYY-MM-DD'),
        'Failed', 'Pending', 'Failed',
        'PDF not found on Fusion server', 1
    );

    -- Trip 3: Today's trip (all pending)
    INSERT INTO wms_trip_config (
        trip_id, trip_date, auto_print_enabled,
        total_orders, downloaded_orders, printed_orders, failed_orders,
        enabled_by, enabled_date
    ) VALUES (
        'TRIP003', TRUNC(SYSDATE), 'Y',
        3, 0, 0, 0,
        'ADMIN', SYSDATE
    ) RETURNING trip_config_id INTO v_trip_config_id;

    INSERT INTO wms_print_jobs (
        trip_config_id, order_number, trip_id, trip_date,
        customer_name, account_number, order_date,
        download_status, print_status, overall_status
    ) VALUES (
        v_trip_config_id, 'ORD201', 'TRIP003', TRUNC(SYSDATE),
        'NextDay Logistics', 'ACC201', TRUNC(SYSDATE),
        'Pending', 'Pending', 'Pending'
    );

    INSERT INTO wms_print_jobs (
        trip_config_id, order_number, trip_id, trip_date,
        customer_name, account_number, order_date,
        download_status, print_status, overall_status
    ) VALUES (
        v_trip_config_id, 'ORD202', 'TRIP003', TRUNC(SYSDATE),
        'Prime Shipping', 'ACC202', TRUNC(SYSDATE),
        'Pending', 'Pending', 'Pending'
    );

    INSERT INTO wms_print_jobs (
        trip_config_id, order_number, trip_id, trip_date,
        customer_name, account_number, order_date,
        download_status, print_status, overall_status
    ) VALUES (
        v_trip_config_id, 'ORD203', 'TRIP003', TRUNC(SYSDATE),
        'Elite Transporters', 'ACC203', TRUNC(SYSDATE),
        'Pending', 'Pending', 'Pending'
    );

    COMMIT;
END;
/

-- ========================================
-- 3. INSERT AUDIT HISTORY (Sample)
-- ========================================
INSERT INTO wms_print_job_history (
    print_job_id, action_type, old_status, new_status,
    message, action_date
)
SELECT
    print_job_id, 'STATUS_UPDATE', 'Pending', 'Completed',
    'Job completed successfully', created_date + INTERVAL '5' MINUTE
FROM wms_print_jobs
WHERE overall_status = 'Completed'
  AND ROWNUM <= 5;

COMMIT;

-- ========================================
-- 4. VERIFICATION QUERIES
-- ========================================
-- Check inserted data
SELECT 'Printer Configs' AS table_name, COUNT(*) AS count FROM wms_printer_config
UNION ALL
SELECT 'Trip Configs', COUNT(*) FROM wms_trip_config
UNION ALL
SELECT 'Print Jobs', COUNT(*) FROM wms_print_jobs
UNION ALL
SELECT 'History Records', COUNT(*) FROM wms_print_job_history;

-- View trip summary
SELECT
    tc.trip_id,
    tc.trip_date,
    tc.total_orders,
    tc.downloaded_orders,
    tc.printed_orders,
    tc.failed_orders,
    ROUND((tc.printed_orders / tc.total_orders) * 100, 2) AS completion_pct
FROM wms_trip_config tc
ORDER BY tc.trip_date DESC;

-- View job status breakdown
SELECT
    overall_status,
    COUNT(*) AS job_count
FROM wms_print_jobs
GROUP BY overall_status
ORDER BY job_count DESC;

-- ========================================
-- END OF TEST DATA
-- ========================================
