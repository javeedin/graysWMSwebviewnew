-- ============================================================
-- WMS ORDER SHIPMENT LINES - APEX REST HANDLERS
-- ============================================================
-- Module:        TRIPMANAGEMENT  (existing module)
-- Run these in APEX SQL Workshop > RESTful Services
-- OR paste each block into the Handler Source in APEX UI
-- ============================================================


-- ============================================================
-- HANDLER 1: POST  /orders/shipmentlines/save
-- ============================================================
-- In APEX RESTful Services:
--   Module:        TRIPMANAGEMENT
--   URI Template:  orders/shipmentlines/save
--   Method:        POST
--   Source Type:   PL/SQL
-- ============================================================
DECLARE
    v_result        VARCHAR2(200);
    v_rows          NUMBER;
    v_order_number  VARCHAR2(50);
    v_instance      VARCHAR2(20);
    v_body          CLOB;
BEGIN
    v_body         := :body_text;
    APEX_JSON.parse(v_body);
    v_order_number := APEX_JSON.get_varchar2('orderNumber');
    v_instance     := NVL(APEX_JSON.get_varchar2('instanceName'), 'TEST');

    wms_save_shipment_lines(
        p_order_number  => v_order_number,
        p_instance_name => v_instance,
        p_json_clob     => v_body,
        p_result        => v_result,
        p_rows_inserted => v_rows
    );

    APEX_JSON.open_object;
    APEX_JSON.write('status',       v_result);
    APEX_JSON.write('rowsInserted', v_rows);
    APEX_JSON.write('orderNumber',  v_order_number);
    APEX_JSON.write('instance',     v_instance);
    APEX_JSON.close_object;
END;


-- ============================================================
-- HANDLER 2: GET  /orders/shipmentlines/:orderNumber
-- ============================================================
-- In APEX RESTful Services:
--   Module:        TRIPMANAGEMENT
--   URI Template:  orders/shipmentlines/:orderNumber
--   Method:        GET
--   Source Type:   PL/SQL
--   Bind Variables auto-bound: :orderNumber (from URI), :P_INSTANCE_NAME (query string)
-- ============================================================
BEGIN
    wms_get_shipment_lines(
        p_order_number  => :orderNumber,
        p_instance_name => NVL(:P_INSTANCE_NAME, 'TEST'),
        p_cursor        => :cursor
    );
END;


-- ============================================================
-- EXAMPLE CALLS
-- ============================================================
-- POST (save lines from Fusion response):
--   URL:  https://<apex-base>/TRIPMANAGEMENT/orders/shipmentlines/save
--   Body: {
--           "orderNumber": "90105000006",
--           "instanceName": "TEST",
--           "items": [ { ...fusion shipmentLines response items... } ]
--         }
--
-- GET (retrieve saved lines):
--   URL:  https://<apex-base>/TRIPMANAGEMENT/orders/shipmentlines/90105000006?P_INSTANCE_NAME=TEST
-- ============================================================
