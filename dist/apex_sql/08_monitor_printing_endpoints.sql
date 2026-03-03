-- ============================================================================
-- MONITOR PRINTING - Auto-Print Trip Management Endpoints
-- ============================================================================
-- This file contains Oracle APEX REST API endpoints for managing auto-print monitoring
--
-- Endpoints:
-- 1. POST /monitor-printing/enable - Enable auto-print for a trip
-- 2. POST /monitor-printing/disable - Disable auto-print for a trip
-- 3. GET /monitor-printing/list - Get list of monitored trips with date filters
-- ============================================================================

-- ============================================================================
-- STEP 1: Create monitoring table (if not exists)
-- ============================================================================

-- Table to store trips being monitored for auto-print
CREATE TABLE wms_monitor_printing (
    monitor_id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    trip_id VARCHAR2(100) NOT NULL,
    trip_date DATE NOT NULL,
    order_count NUMBER DEFAULT 0,
    printer_config_id NUMBER NOT NULL,
    printer_name VARCHAR2(200),
    status VARCHAR2(50) DEFAULT 'PENDING_DOWNLOAD',
    enabled_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    enabled_by VARCHAR2(100),
    CONSTRAINT fk_monitor_printer FOREIGN KEY (printer_config_id)
        REFERENCES wms_printer_config(config_id)
);

-- Index for faster queries
CREATE INDEX idx_monitor_trip ON wms_monitor_printing(trip_id, trip_date);
CREATE INDEX idx_monitor_status ON wms_monitor_printing(status);
CREATE INDEX idx_monitor_date ON wms_monitor_printing(trip_date);

-- ============================================================================
-- STEP 2: Create stored procedures
-- ============================================================================

-- Procedure to enable auto-print for a trip
CREATE OR REPLACE PROCEDURE wms_enable_monitor_printing (
    p_trip_id IN VARCHAR2,
    p_trip_date IN VARCHAR2,
    p_order_count IN NUMBER,
    p_printer_config_id IN NUMBER,
    p_printer_name IN VARCHAR2,
    p_result OUT VARCHAR2
) AS
    v_trip_date_parsed DATE;
    v_existing_count NUMBER;
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
    SELECT COUNT(*)
    INTO v_existing_count
    FROM wms_monitor_printing
    WHERE trip_id = p_trip_id
      AND trip_date = v_trip_date_parsed;

    IF v_existing_count > 0 THEN
        -- Update existing
        UPDATE wms_monitor_printing
        SET order_count = p_order_count,
            printer_config_id = p_printer_config_id,
            printer_name = p_printer_name,
            status = 'PENDING_DOWNLOAD',
            last_updated = CURRENT_TIMESTAMP
        WHERE trip_id = p_trip_id
          AND trip_date = v_trip_date_parsed;
    ELSE
        -- Insert new
        INSERT INTO wms_monitor_printing (
            trip_id,
            trip_date,
            order_count,
            printer_config_id,
            printer_name,
            status,
            enabled_by
        ) VALUES (
            p_trip_id,
            v_trip_date_parsed,
            p_order_count,
            p_printer_config_id,
            p_printer_name,
            'PENDING_DOWNLOAD',
            USER
        );
    END IF;

    COMMIT;
    p_result := 'SUCCESS';

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        p_result := 'ERROR: ' || SQLERRM;
END wms_enable_monitor_printing;
/

-- Procedure to disable auto-print for a trip
CREATE OR REPLACE PROCEDURE wms_disable_monitor_printing (
    p_trip_id IN VARCHAR2,
    p_trip_date IN VARCHAR2,
    p_result OUT VARCHAR2
) AS
    v_trip_date_parsed DATE;
BEGIN
    -- Parse trip date
    BEGIN
        v_trip_date_parsed := TO_DATE(p_trip_date, 'YYYY-MM-DD');
    EXCEPTION
        WHEN OTHERS THEN
            p_result := 'ERROR: Invalid date format. Use YYYY-MM-DD';
            RETURN;
    END;

    -- Delete the monitoring record
    DELETE FROM wms_monitor_printing
    WHERE trip_id = p_trip_id
      AND trip_date = v_trip_date_parsed;

    COMMIT;
    p_result := 'SUCCESS';

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        p_result := 'ERROR: ' || SQLERRM;
END wms_disable_monitor_printing;
/

-- Procedure to get monitored trips list
CREATE OR REPLACE PROCEDURE wms_get_monitor_printing_list (
    p_from_date IN VARCHAR2,
    p_to_date IN VARCHAR2,
    p_cursor OUT SYS_REFCURSOR
) AS
    v_from_date DATE;
    v_to_date DATE;
BEGIN
    -- Parse dates
    BEGIN
        v_from_date := TO_DATE(p_from_date, 'YYYY-MM-DD');
        v_to_date := TO_DATE(p_to_date, 'YYYY-MM-DD');
    EXCEPTION
        WHEN OTHERS THEN
            -- Return empty cursor if dates are invalid
            OPEN p_cursor FOR
            SELECT NULL AS monitor_id FROM DUAL WHERE 1=0;
            RETURN;
    END;

    OPEN p_cursor FOR
    SELECT
        monitor_id,
        trip_id,
        TO_CHAR(trip_date, 'YYYY-MM-DD') AS trip_date,
        order_count,
        printer_config_id,
        printer_name,
        status,
        TO_CHAR(enabled_date, 'YYYY-MM-DD HH24:MI:SS') AS enabled_date,
        TO_CHAR(last_updated, 'YYYY-MM-DD HH24:MI:SS') AS last_updated,
        enabled_by
    FROM wms_monitor_printing
    WHERE trip_date BETWEEN v_from_date AND v_to_date
    ORDER BY trip_date DESC, trip_id;

END wms_get_monitor_printing_list;
/

-- ============================================================================
-- STEP 3: Create APEX REST API Endpoints
-- ============================================================================

-- IMPORTANT: Run these in Oracle APEX SQL Workshop
-- Navigate to: SQL Workshop > RESTful Services

-- ----------------------------------------------------------------------------
-- ENDPOINT 1: POST /monitor-printing/enable
-- ----------------------------------------------------------------------------
-- Method: POST
-- Source Type: PL/SQL
-- Source:

DECLARE
    v_trip_id VARCHAR2(100);
    v_trip_date VARCHAR2(20);
    v_order_count NUMBER;
    v_printer_config_id NUMBER;
    v_printer_name VARCHAR2(200);
    v_result VARCHAR2(500);
BEGIN
    -- Parse JSON body
    v_trip_id := APEX_JSON.get_varchar2(p_path => 'tripId');
    v_trip_date := APEX_JSON.get_varchar2(p_path => 'tripDate');
    v_order_count := APEX_JSON.get_number(p_path => 'orderCount');
    v_printer_config_id := APEX_JSON.get_number(p_path => 'printerConfigId');
    v_printer_name := APEX_JSON.get_varchar2(p_path => 'printerName');

    -- Call procedure
    wms_enable_monitor_printing(
        p_trip_id => v_trip_id,
        p_trip_date => v_trip_date,
        p_order_count => v_order_count,
        p_printer_config_id => v_printer_config_id,
        p_printer_name => v_printer_name,
        p_result => v_result
    );

    -- Return result
    IF v_result = 'SUCCESS' THEN
        HTP.p('{"success":true,"message":"Auto-print enabled successfully"}');
    ELSE
        HTP.p('{"success":false,"message":"' || REPLACE(v_result, '"', '\"') || '"}');
    END IF;
END;

-- ----------------------------------------------------------------------------
-- ENDPOINT 2: POST /monitor-printing/disable
-- ----------------------------------------------------------------------------
-- Method: POST
-- Source Type: PL/SQL
-- Source:

DECLARE
    v_trip_id VARCHAR2(100);
    v_trip_date VARCHAR2(20);
    v_result VARCHAR2(500);
BEGIN
    -- Parse JSON body
    v_trip_id := APEX_JSON.get_varchar2(p_path => 'tripId');
    v_trip_date := APEX_JSON.get_varchar2(p_path => 'tripDate');

    -- Call procedure
    wms_disable_monitor_printing(
        p_trip_id => v_trip_id,
        p_trip_date => v_trip_date,
        p_result => v_result
    );

    -- Return result
    IF v_result = 'SUCCESS' THEN
        HTP.p('{"success":true,"message":"Auto-print disabled successfully"}');
    ELSE
        HTP.p('{"success":false,"message":"' || REPLACE(v_result, '"', '\"') || '"}');
    END IF;
END;

-- ----------------------------------------------------------------------------
-- ENDPOINT 3: GET /monitor-printing/list
-- ----------------------------------------------------------------------------
-- Method: GET
-- Source Type: PL/SQL
-- Parameters: fromDate (Query String), toDate (Query String)
-- Source:

DECLARE
    v_cursor SYS_REFCURSOR;
    v_from_date VARCHAR2(20);
    v_to_date VARCHAR2(20);

    v_monitor_id NUMBER;
    v_trip_id VARCHAR2(100);
    v_trip_date VARCHAR2(20);
    v_order_count NUMBER;
    v_printer_config_id NUMBER;
    v_printer_name VARCHAR2(200);
    v_status VARCHAR2(50);
    v_enabled_date VARCHAR2(30);
    v_last_updated VARCHAR2(30);
    v_enabled_by VARCHAR2(100);

    v_first BOOLEAN := TRUE;
BEGIN
    -- Get query parameters
    v_from_date := :fromDate;
    v_to_date := :toDate;

    -- Call procedure
    wms_get_monitor_printing_list(
        p_from_date => v_from_date,
        p_to_date => v_to_date,
        p_cursor => v_cursor
    );

    -- Build JSON response manually
    HTP.p('{"items":[');

    LOOP
        FETCH v_cursor INTO
            v_monitor_id,
            v_trip_id,
            v_trip_date,
            v_order_count,
            v_printer_config_id,
            v_printer_name,
            v_status,
            v_enabled_date,
            v_last_updated,
            v_enabled_by;

        EXIT WHEN v_cursor%NOTFOUND;

        IF NOT v_first THEN
            HTP.p(',');
        END IF;
        v_first := FALSE;

        HTP.p('{');
        HTP.p('"monitorId":' || v_monitor_id || ',');
        HTP.p('"tripId":"' || REPLACE(v_trip_id, '"', '\"') || '",');
        HTP.p('"tripDate":"' || v_trip_date || '",');
        HTP.p('"orderCount":' || v_order_count || ',');
        HTP.p('"printerConfigId":' || v_printer_config_id || ',');
        HTP.p('"printerName":"' || REPLACE(v_printer_name, '"', '\"') || '",');
        HTP.p('"status":"' || v_status || '",');
        HTP.p('"enabledDate":"' || v_enabled_date || '",');
        HTP.p('"lastUpdated":"' || v_last_updated || '",');
        HTP.p('"enabledBy":"' || COALESCE(REPLACE(v_enabled_by, '"', '\"'), '') || '"');
        HTP.p('}');
    END LOOP;

    CLOSE v_cursor;
    HTP.p(']}');
END;

-- ============================================================================
-- END OF FILE
-- ============================================================================

/*
SETUP INSTRUCTIONS:

1. Run this entire SQL file in Oracle SQL Developer or SQL*Plus to create:
   - wms_monitor_printing table
   - Stored procedures

2. In Oracle APEX (SQL Workshop > RESTful Services):

   a) Create Endpoint: POST /monitor-printing/enable
      - Copy the PL/SQL code from ENDPOINT 1 section above
      - Set Source Type to "PL/SQL"

   b) Create Endpoint: POST /monitor-printing/disable
      - Copy the PL/SQL code from ENDPOINT 2 section above
      - Set Source Type to "PL/SQL"

   c) Create Endpoint: GET /monitor-printing/list
      - Copy the PL/SQL code from ENDPOINT 3 section above
      - Set Source Type to "PL/SQL"
      - Add two Query String parameters: fromDate and toDate

3. Test endpoints using Postman or the browser

EXAMPLE API CALLS:

POST /monitor-printing/enable
Body: {
  "tripId": "TRIP001",
  "tripDate": "2025-11-06",
  "orderCount": 15,
  "printerConfigId": 1,
  "printerName": "HP LaserJet Pro"
}

GET /monitor-printing/list?fromDate=2025-11-01&toDate=2025-11-06

POST /monitor-printing/disable
Body: {
  "tripId": "TRIP001",
  "tripDate": "2025-11-06"
}
*/
