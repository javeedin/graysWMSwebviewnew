-- ============================================================================
-- FIXED PROCEDURE - wms_enable_monitor_printing_v2
-- ============================================================================
-- This version uses APEX_JSON instead of JSON_ARRAY_T/JSON_OBJECT_T
-- which is more compatible and handles edge cases better
-- ============================================================================

CREATE OR REPLACE PROCEDURE wms_enable_monitor_printing_v2 (
    p_trip_id IN VARCHAR2,
    p_trip_date IN VARCHAR2,
    p_order_count IN NUMBER,
    p_printer_config_id IN NUMBER,
    p_printer_name IN VARCHAR2,
    p_orders_json IN CLOB,
    p_result OUT VARCHAR2,
    p_monitor_id OUT NUMBER
) AS
    v_trip_date_parsed DATE;
    v_existing_count NUMBER;
    v_monitor_id NUMBER;
    v_order_count NUMBER;
    v_order_number VARCHAR2(100);
    v_customer_name VARCHAR2(200);
    v_account_number VARCHAR2(100);
    v_order_date DATE;
    v_order_date_str VARCHAR2(20);
BEGIN
    -- Parse trip date
    BEGIN
        v_trip_date_parsed := TO_DATE(p_trip_date, 'YYYY-MM-DD');
    EXCEPTION
        WHEN OTHERS THEN
            p_result := 'ERROR: Invalid date format. Use YYYY-MM-DD';
            RETURN;
    END;

    -- Check if already exists
    SELECT COUNT(*), MAX(monitor_id)
    INTO v_existing_count, v_monitor_id
    FROM wms_monitor_printing
    WHERE trip_id = p_trip_id
      AND trip_date = v_trip_date_parsed;

    IF v_existing_count > 0 THEN
        -- Update existing trip
        UPDATE wms_monitor_printing
        SET order_count = p_order_count,
            printer_config_id = p_printer_config_id,
            printer_name = p_printer_name,
            status = 'PENDING_DOWNLOAD',
            last_updated = CURRENT_TIMESTAMP
        WHERE monitor_id = v_monitor_id;

        -- Delete old order details
        DELETE FROM wms_monitor_printing_details
        WHERE monitor_id = v_monitor_id;
    ELSE
        -- Insert new trip
        INSERT INTO wms_monitor_printing (
            trip_id, trip_date, order_count, printer_config_id,
            printer_name, status, enabled_by
        ) VALUES (
            p_trip_id, v_trip_date_parsed, p_order_count, p_printer_config_id,
            p_printer_name, 'PENDING_DOWNLOAD', USER
        ) RETURNING monitor_id INTO v_monitor_id;
    END IF;

    -- Parse and insert order details using APEX_JSON
    IF p_orders_json IS NOT NULL AND LENGTH(p_orders_json) > 0 THEN
        BEGIN
            -- Parse the orders JSON array
            APEX_JSON.parse(p_orders_json);

            -- Get count of orders in array
            v_order_count := APEX_JSON.get_count(p_path => '.');

            -- Loop through each order
            FOR i IN 1 .. v_order_count LOOP
                -- Get order fields using array index notation
                v_order_number := APEX_JSON.get_varchar2(p_path => '[%d].orderNumber', p0 => i);
                v_customer_name := APEX_JSON.get_varchar2(p_path => '[%d].customerName', p0 => i);
                v_account_number := APEX_JSON.get_varchar2(p_path => '[%d].accountNumber', p0 => i);
                v_order_date_str := APEX_JSON.get_varchar2(p_path => '[%d].orderDate', p0 => i);

                -- Parse order date
                BEGIN
                    v_order_date := TO_DATE(v_order_date_str, 'YYYY-MM-DD');
                EXCEPTION
                    WHEN OTHERS THEN
                        v_order_date := v_trip_date_parsed;
                END;

                -- Insert order detail
                INSERT INTO wms_monitor_printing_details (
                    monitor_id, order_number, customer_name, account_number,
                    order_date, pdf_status, print_status
                ) VALUES (
                    v_monitor_id, v_order_number, v_customer_name, v_account_number,
                    v_order_date, 'PENDING', 'PENDING'
                );
            END LOOP;

        EXCEPTION
            WHEN OTHERS THEN
                ROLLBACK;
                p_result := 'ERROR: Failed to parse orders at index ' || v_order_count || ': ' || SQLERRM;
                RETURN;
        END;
    END IF;

    COMMIT;
    p_result := 'SUCCESS';
    p_monitor_id := v_monitor_id;

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        p_result := 'ERROR: ' || SQLERRM;
END wms_enable_monitor_printing_v2;
/

-- ============================================================================
-- VERIFICATION: Check if procedure is valid
-- ============================================================================

SELECT object_name, object_type, status
FROM user_objects
WHERE object_name = 'WMS_ENABLE_MONITOR_PRINTING_V2';

-- If STATUS = INVALID, check errors:
-- SELECT * FROM user_errors WHERE name = 'WMS_ENABLE_MONITOR_PRINTING_V2';

-- ============================================================================
-- TEST THE PROCEDURE DIRECTLY
-- ============================================================================

DECLARE
    v_result VARCHAR2(500);
    v_monitor_id NUMBER;
    v_orders_json CLOB := '[
        {
            "orderNumber": "ORD001",
            "customerName": "Customer ABC",
            "accountNumber": "ACC123",
            "orderDate": "2025-11-07"
        },
        {
            "orderNumber": "ORD002",
            "customerName": "Customer XYZ",
            "accountNumber": "ACC456",
            "orderDate": "2025-11-07"
        }
    ]';
BEGIN
    wms_enable_monitor_printing_v2(
        p_trip_id => 'TEST999',
        p_trip_date => '2025-11-07',
        p_order_count => 2,
        p_printer_config_id => 21,
        p_printer_name => 'Test Printer',
        p_orders_json => v_orders_json,
        p_result => v_result,
        p_monitor_id => v_monitor_id
    );

    DBMS_OUTPUT.PUT_LINE('Result: ' || v_result);
    DBMS_OUTPUT.PUT_LINE('Monitor ID: ' || v_monitor_id);

    -- Check orders were saved
    FOR rec IN (
        SELECT order_number, customer_name
        FROM wms_monitor_printing_details
        WHERE monitor_id = v_monitor_id
        ORDER BY order_number
    ) LOOP
        DBMS_OUTPUT.PUT_LINE('Order: ' || rec.order_number || ' - ' || rec.customer_name);
    END LOOP;
END;
/

-- ============================================================================
-- AFTER RUNNING THIS FILE:
-- ============================================================================
-- 1. Check procedure is VALID (see SELECT above)
-- 2. Run the test block (should output: Result: SUCCESS)
-- 3. Check orders were saved:
--    SELECT * FROM wms_monitor_printing_details WHERE monitor_id IN (SELECT monitor_id FROM wms_monitor_printing WHERE trip_id = 'TEST999');
-- 4. Go back to APEX and test the POST endpoint again
-- ============================================================================
