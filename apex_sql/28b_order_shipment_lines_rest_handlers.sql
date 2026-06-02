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
--   Source Type:   SQL Query        <-- IMPORTANT: use SQL Query, NOT PL/SQL
--   Bind Variables auto-bound: :orderNumber (from URI), :P_INSTANCE_NAME (query string)
-- ============================================================
SELECT
    id,
    shipment_line,
    order_number,
    order_line,
    order_type_code,
    order_type,
    source_order_line,
    source_order_fulfillment_line,
    item,
    item_description,
    requested_quantity,
    shipped_quantity,
    staged_quantity,
    picked_quantity,
    cancelled_quantity,
    backordered_quantity,
    pending_quantity,
    subinventory_name,
    line_status_code,
    line_status,
    ship_to_customer,
    ship_to_customer_number,
    ship_to_address1,
    ship_to_city,
    ship_to_country,
    organization_code,
    pick_wave,
    shipment,
    shipment_status_code,
    movement_request_number,
    integration_status,
    currency_code,
    unit_price,
    instance_name,
    creation_date,
    last_update_date,
    wms_created_date,
    wms_last_updated_date
FROM wms_order_shipment_lines
WHERE order_number  = :orderNumber
  AND instance_name = NVL(UPPER(:P_INSTANCE_NAME), 'TEST')
ORDER BY shipment_line ASC


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
