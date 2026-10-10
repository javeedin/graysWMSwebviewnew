-- ============================================================
-- WMS ORDER SHIPMENT LINES - TABLE + PROCEDURE + REST ENDPOINT
-- ============================================================
-- Created: 2026-06-02
-- Purpose: Store Oracle Fusion shipmentLines API results for an order
-- Source:  GET /fscmRestApi/resources/11.13.18.05/shipmentLines?q=Order={orderNumber}
-- ============================================================


-- ============================================================
-- STEP 1: CREATE TABLE WMS_ORDER_SHIPMENT_LINES
-- ============================================================
CREATE TABLE wms_order_shipment_lines (
    id                              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- Key identifiers
    shipment_line                   NUMBER,
    order_number                    VARCHAR2(50),
    order_line                      VARCHAR2(50),
    order_type_code                 VARCHAR2(50),
    order_type                      VARCHAR2(100),
    order_schedule                  VARCHAR2(200),
    -- Source order info
    source_order_id                 NUMBER,
    source_order                    VARCHAR2(50),
    source_order_line_id            NUMBER,
    source_order_line               VARCHAR2(50),
    source_order_fulfillment_line_id NUMBER,
    source_order_fulfillment_line   VARCHAR2(100),
    -- Item info
    inventory_item_id               NUMBER,
    item                            VARCHAR2(100),
    item_description                VARCHAR2(500),
    -- Quantities
    requested_quantity              NUMBER,
    requested_quantity_uom_code     VARCHAR2(20),
    requested_quantity_uom          VARCHAR2(50),
    shipped_quantity                NUMBER,
    staged_quantity                 NUMBER,
    picked_quantity                 NUMBER,
    cancelled_quantity              NUMBER,
    backordered_quantity            NUMBER,
    converted_quantity              NUMBER,
    pending_quantity                NUMBER,
    source_requested_quantity       NUMBER,
    -- Pricing
    unit_price                      NUMBER,
    selling_price                   NUMBER,
    currency_code                   VARCHAR2(10),
    -- Shipment
    shipment_id                     NUMBER,
    shipment                        VARCHAR2(50),
    shipment_status_code            VARCHAR2(20),
    line_status_code                VARCHAR2(10),
    line_status                     VARCHAR2(100),
    -- Pick wave
    pick_wave_id                    NUMBER,
    pick_wave                       VARCHAR2(200),
    movement_request_line_id        NUMBER,
    movement_request_number         VARCHAR2(200),
    movement_request_line_number    VARCHAR2(50),
    -- Inventory
    organization_id                 NUMBER,
    organization_code               VARCHAR2(20),
    organization_name               VARCHAR2(200),
    subinventory                    VARCHAR2(100),
    subinventory_name               VARCHAR2(100),
    source_subinventory             VARCHAR2(100),
    source_subinventory_name        VARCHAR2(100),
    lot_number                      VARCHAR2(100),
    -- Ship to
    ship_to_party_id                NUMBER,
    ship_to_customer                VARCHAR2(300),
    ship_to_customer_number         VARCHAR2(50),
    ship_to_location_id             NUMBER,
    ship_to_address1                VARCHAR2(300),
    ship_to_address2                VARCHAR2(300),
    ship_to_city                    VARCHAR2(100),
    ship_to_postal_code             VARCHAR2(20),
    ship_to_country                 VARCHAR2(10),
    ship_to_location                VARCHAR2(500),
    -- Dates
    requested_date                  TIMESTAMP WITH TIME ZONE,
    scheduled_ship_date             TIMESTAMP WITH TIME ZONE,
    actual_ship_date                TIMESTAMP WITH TIME ZONE,
    creation_date                   TIMESTAMP WITH TIME ZONE,
    last_update_date                TIMESTAMP WITH TIME ZONE,
    source_line_update_date         TIMESTAMP WITH TIME ZONE,
    -- Other flags / codes
    integration_status_code         VARCHAR2(20),
    integration_status              VARCHAR2(100),
    inv_interfaced_flag_code        VARCHAR2(5),
    pending_quantity_flag           VARCHAR2(5),
    enforce_single_shipment         VARCHAR2(5),
    cancel_backorders               VARCHAR2(5),
    business_unit                   VARCHAR2(200),
    legal_entity                    VARCHAR2(200),
    created_by_fusion               VARCHAR2(100),
    last_updated_by_fusion          VARCHAR2(100),
    -- WMS audit
    instance_name                   VARCHAR2(20) DEFAULT 'TEST',
    wms_created_date                DATE DEFAULT SYSDATE,
    wms_created_by                  VARCHAR2(100) DEFAULT USER,
    wms_last_updated_date           DATE,
    wms_last_updated_by             VARCHAR2(100)
);

-- Indexes
CREATE INDEX idx_wosl_order_number    ON wms_order_shipment_lines(order_number);
CREATE INDEX idx_wosl_shipment_line   ON wms_order_shipment_lines(shipment_line);
CREATE INDEX idx_wosl_line_status     ON wms_order_shipment_lines(line_status_code);
CREATE INDEX idx_wosl_instance        ON wms_order_shipment_lines(instance_name);

COMMENT ON TABLE  wms_order_shipment_lines                        IS 'Oracle Fusion shipmentLines data synced per order';
COMMENT ON COLUMN wms_order_shipment_lines.shipment_line          IS 'Fusion ShipmentLine (delivery detail id)';
COMMENT ON COLUMN wms_order_shipment_lines.order_number           IS 'Source order number (e.g. 90105000006)';
COMMENT ON COLUMN wms_order_shipment_lines.line_status_code       IS 'Y=Staged, C=Confirmed, X=Cancelled etc.';
COMMENT ON COLUMN wms_order_shipment_lines.instance_name          IS 'TEST or PROD Fusion instance';


-- ============================================================
-- STEP 2: PROCEDURE wms_save_shipment_lines
--         Accepts JSON array from Fusion API and upserts rows.
--         Deletes existing rows for the order first, then inserts.
-- ============================================================
CREATE OR REPLACE PROCEDURE wms_save_shipment_lines (
    p_order_number  IN VARCHAR2,
    p_instance_name IN VARCHAR2,
    p_json_clob     IN CLOB,
    p_result        OUT VARCHAR2,
    p_rows_inserted OUT NUMBER
) AS
    v_count         NUMBER := 0;
    v_item_count    NUMBER;
    v_prefix        VARCHAR2(50);

    -- Row variables
    v_shipment_line                   NUMBER;
    v_order_number                    VARCHAR2(50);
    v_order_line                      VARCHAR2(50);
    v_order_type_code                 VARCHAR2(50);
    v_order_type                      VARCHAR2(100);
    v_order_schedule                  VARCHAR2(200);
    v_source_order_id                 NUMBER;
    v_source_order                    VARCHAR2(50);
    v_source_order_line_id            NUMBER;
    v_source_order_line               VARCHAR2(50);
    v_source_order_fulfillment_line_id NUMBER;
    v_source_order_fulfillment_line   VARCHAR2(100);
    v_inventory_item_id               NUMBER;
    v_item                            VARCHAR2(100);
    v_item_description                VARCHAR2(500);
    v_requested_quantity              NUMBER;
    v_requested_quantity_uom_code     VARCHAR2(20);
    v_requested_quantity_uom          VARCHAR2(50);
    v_shipped_quantity                NUMBER;
    v_staged_quantity                 NUMBER;
    v_picked_quantity                 NUMBER;
    v_cancelled_quantity              NUMBER;
    v_backordered_quantity            NUMBER;
    v_converted_quantity              NUMBER;
    v_pending_quantity                NUMBER;
    v_source_requested_quantity       NUMBER;
    v_unit_price                      NUMBER;
    v_selling_price                   NUMBER;
    v_currency_code                   VARCHAR2(10);
    v_shipment_id                     NUMBER;
    v_shipment                        VARCHAR2(50);
    v_shipment_status_code            VARCHAR2(20);
    v_line_status_code                VARCHAR2(10);
    v_line_status                     VARCHAR2(100);
    v_pick_wave_id                    NUMBER;
    v_pick_wave                       VARCHAR2(200);
    v_movement_request_line_id        NUMBER;
    v_movement_request_number         VARCHAR2(200);
    v_movement_request_line_number    VARCHAR2(50);
    v_organization_id                 NUMBER;
    v_organization_code               VARCHAR2(20);
    v_organization_name               VARCHAR2(200);
    v_subinventory                    VARCHAR2(100);
    v_subinventory_name               VARCHAR2(100);
    v_source_subinventory             VARCHAR2(100);
    v_source_subinventory_name        VARCHAR2(100);
    v_lot_number                      VARCHAR2(100);
    v_ship_to_party_id                NUMBER;
    v_ship_to_customer                VARCHAR2(300);
    v_ship_to_customer_number         VARCHAR2(50);
    v_ship_to_location_id             NUMBER;
    v_ship_to_address1                VARCHAR2(300);
    v_ship_to_address2                VARCHAR2(300);
    v_ship_to_city                    VARCHAR2(100);
    v_ship_to_postal_code             VARCHAR2(20);
    v_ship_to_country                 VARCHAR2(10);
    v_ship_to_location                VARCHAR2(500);
    v_requested_date                  TIMESTAMP WITH TIME ZONE;
    v_scheduled_ship_date             TIMESTAMP WITH TIME ZONE;
    v_actual_ship_date                TIMESTAMP WITH TIME ZONE;
    v_creation_date                   TIMESTAMP WITH TIME ZONE;
    v_last_update_date                TIMESTAMP WITH TIME ZONE;
    v_source_line_update_date         TIMESTAMP WITH TIME ZONE;
    v_integration_status_code         VARCHAR2(20);
    v_integration_status              VARCHAR2(100);
    v_inv_interfaced_flag_code        VARCHAR2(5);
    v_pending_quantity_flag           VARCHAR2(5);
    v_enforce_single_shipment         VARCHAR2(5);
    v_cancel_backorders               VARCHAR2(5);
    v_business_unit                   VARCHAR2(200);
    v_legal_entity                    VARCHAR2(200);
    v_created_by_fusion               VARCHAR2(100);
    v_last_updated_by_fusion          VARCHAR2(100);
    v_pending_flag_str                VARCHAR2(10);

    -- Safe getters (variables in VALUES clause are fine; functions are not)
    FUNCTION safe_str(p_path IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        RETURN APEX_JSON.get_varchar2(p_path);
    EXCEPTION WHEN OTHERS THEN RETURN NULL;
    END;

    FUNCTION safe_num(p_path IN VARCHAR2) RETURN NUMBER IS
    BEGIN
        RETURN APEX_JSON.get_number(p_path);
    EXCEPTION WHEN OTHERS THEN RETURN NULL;
    END;

    FUNCTION safe_tstz(p_str IN VARCHAR2) RETURN TIMESTAMP WITH TIME ZONE IS
    BEGIN
        IF p_str IS NULL THEN RETURN NULL; END IF;
        RETURN TO_TIMESTAMP_TZ(p_str, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM');
    EXCEPTION WHEN OTHERS THEN RETURN NULL;
    END;

BEGIN
    p_rows_inserted := 0;

    DELETE FROM wms_order_shipment_lines
    WHERE order_number  = p_order_number
      AND instance_name = NVL(UPPER(p_instance_name), 'TEST');

    APEX_JSON.parse(p_json_clob);

    BEGIN
        v_item_count := APEX_JSON.get_count('items');
    EXCEPTION WHEN OTHERS THEN
        v_item_count := 0;
    END;

    IF NVL(v_item_count, 0) = 0 THEN
        BEGIN
            v_item_count := APEX_JSON.get_count('.');
        EXCEPTION WHEN OTHERS THEN
            v_item_count := 0;
        END;
    END IF;

    FOR i IN 1..NVL(v_item_count, 0) LOOP
        BEGIN
            v_prefix := 'items[' || i || '].';

            -- Extract all fields into variables first
            v_shipment_line                   := safe_num(v_prefix || 'ShipmentLine');
            v_order_number                    := NVL(safe_str(v_prefix || 'Order'), p_order_number);
            v_order_line                      := safe_str(v_prefix || 'OrderLine');
            v_order_type_code                 := safe_str(v_prefix || 'OrderTypeCode');
            v_order_type                      := safe_str(v_prefix || 'OrderType');
            v_order_schedule                  := safe_str(v_prefix || 'OrderSchedule');
            v_source_order_id                 := safe_num(v_prefix || 'SourceOrderId');
            v_source_order                    := safe_str(v_prefix || 'SourceOrder');
            v_source_order_line_id            := safe_num(v_prefix || 'SourceOrderLineId');
            v_source_order_line               := safe_str(v_prefix || 'SourceOrderLine');
            v_source_order_fulfillment_line_id := safe_num(v_prefix || 'SourceOrderFulfillmentLineId');
            v_source_order_fulfillment_line   := safe_str(v_prefix || 'SourceOrderFulfillmentLine');
            v_inventory_item_id               := safe_num(v_prefix || 'InventoryItemId');
            v_item                            := safe_str(v_prefix || 'Item');
            v_item_description                := safe_str(v_prefix || 'ItemDescription');
            v_requested_quantity              := safe_num(v_prefix || 'RequestedQuantity');
            v_requested_quantity_uom_code     := safe_str(v_prefix || 'RequestedQuantityUOMCode');
            v_requested_quantity_uom          := safe_str(v_prefix || 'RequestedQuantityUOM');
            v_shipped_quantity                := safe_num(v_prefix || 'ShippedQuantity');
            v_staged_quantity                 := safe_num(v_prefix || 'StagedQuantity');
            v_picked_quantity                 := safe_num(v_prefix || 'PickedQuantity');
            v_cancelled_quantity              := safe_num(v_prefix || 'CancelledQuantity');
            v_backordered_quantity            := safe_num(v_prefix || 'BackorderedQuantity');
            v_converted_quantity              := safe_num(v_prefix || 'ConvertedQuantity');
            v_pending_quantity                := safe_num(v_prefix || 'PendingQuantity');
            v_source_requested_quantity       := safe_num(v_prefix || 'SourceRequestedQuantity');
            v_unit_price                      := safe_num(v_prefix || 'UnitPrice');
            v_selling_price                   := safe_num(v_prefix || 'SellingPrice');
            v_currency_code                   := safe_str(v_prefix || 'CurrencyCode');
            v_shipment_id                     := safe_num(v_prefix || 'ShipmentId');
            v_shipment                        := safe_str(v_prefix || 'Shipment');
            v_shipment_status_code            := safe_str(v_prefix || 'ShipmentStatusCode');
            v_line_status_code                := safe_str(v_prefix || 'LineStatusCode');
            v_line_status                     := safe_str(v_prefix || 'LineStatus');
            v_pick_wave_id                    := safe_num(v_prefix || 'PickWaveId');
            v_pick_wave                       := safe_str(v_prefix || 'PickWave');
            v_movement_request_line_id        := safe_num(v_prefix || 'MovementRequestLineId');
            v_movement_request_number         := safe_str(v_prefix || 'MovementRequestNumber');
            v_movement_request_line_number    := safe_str(v_prefix || 'MovementRequestLineNumber');
            v_organization_id                 := safe_num(v_prefix || 'OrganizationId');
            v_organization_code               := safe_str(v_prefix || 'OrganizationCode');
            v_organization_name               := safe_str(v_prefix || 'OrganizationName');
            v_subinventory                    := safe_str(v_prefix || 'Subinventory');
            v_subinventory_name               := safe_str(v_prefix || 'SubinventoryName');
            v_source_subinventory             := safe_str(v_prefix || 'SourceSubinventory');
            v_source_subinventory_name        := safe_str(v_prefix || 'SourceSubinventoryName');
            v_lot_number                      := safe_str(v_prefix || 'LotNumber');
            v_ship_to_party_id                := safe_num(v_prefix || 'ShipToPartyId');
            v_ship_to_customer                := safe_str(v_prefix || 'ShipToCustomer');
            v_ship_to_customer_number         := safe_str(v_prefix || 'ShipToCustomerNumber');
            v_ship_to_location_id             := safe_num(v_prefix || 'ShipToLocationId');
            v_ship_to_address1                := safe_str(v_prefix || 'ShipToAddress1');
            v_ship_to_address2                := safe_str(v_prefix || 'ShipToAddress2');
            v_ship_to_city                    := safe_str(v_prefix || 'ShipToCity');
            v_ship_to_postal_code             := safe_str(v_prefix || 'ShipToPostalCode');
            v_ship_to_country                 := safe_str(v_prefix || 'ShipToCountry');
            v_ship_to_location                := safe_str(v_prefix || 'ShipToLocation');
            v_requested_date                  := safe_tstz(safe_str(v_prefix || 'RequestedDate'));
            v_scheduled_ship_date             := safe_tstz(safe_str(v_prefix || 'ScheduledShipDate'));
            v_actual_ship_date                := safe_tstz(safe_str(v_prefix || 'ActualShipDate'));
            v_creation_date                   := safe_tstz(safe_str(v_prefix || 'CreationDate'));
            v_last_update_date                := safe_tstz(safe_str(v_prefix || 'LastUpdateDate'));
            v_source_line_update_date         := safe_tstz(safe_str(v_prefix || 'SourceLineUpdateDate'));
            v_integration_status_code         := safe_str(v_prefix || 'IntegrationStatusCode');
            v_integration_status              := safe_str(v_prefix || 'IntegrationStatus');
            v_inv_interfaced_flag_code        := safe_str(v_prefix || 'InvInterfacedFlagCode');
            v_pending_flag_str                := safe_str(v_prefix || 'PendingQuantityFlag');
            v_pending_quantity_flag           := CASE WHEN v_pending_flag_str = 'true' THEN 'Y' ELSE 'N' END;
            v_enforce_single_shipment         := safe_str(v_prefix || 'EnforceSingleShipment');
            v_cancel_backorders               := safe_str(v_prefix || 'CancelBackorders');
            v_business_unit                   := safe_str(v_prefix || 'BusinessUnit');
            v_legal_entity                    := safe_str(v_prefix || 'LegalEntity');
            v_created_by_fusion               := safe_str(v_prefix || 'CreatedBy');
            v_last_updated_by_fusion          := safe_str(v_prefix || 'LastUpdatedBy');

            INSERT INTO wms_order_shipment_lines (
                shipment_line, order_number, order_line,
                order_type_code, order_type, order_schedule,
                source_order_id, source_order, source_order_line_id,
                source_order_line, source_order_fulfillment_line_id, source_order_fulfillment_line,
                inventory_item_id, item, item_description,
                requested_quantity, requested_quantity_uom_code, requested_quantity_uom,
                shipped_quantity, staged_quantity, picked_quantity,
                cancelled_quantity, backordered_quantity, converted_quantity,
                pending_quantity, source_requested_quantity,
                unit_price, selling_price, currency_code,
                shipment_id, shipment, shipment_status_code,
                line_status_code, line_status,
                pick_wave_id, pick_wave,
                movement_request_line_id, movement_request_number, movement_request_line_number,
                organization_id, organization_code, organization_name,
                subinventory, subinventory_name, source_subinventory, source_subinventory_name,
                lot_number,
                ship_to_party_id, ship_to_customer, ship_to_customer_number,
                ship_to_location_id, ship_to_address1, ship_to_address2,
                ship_to_city, ship_to_postal_code, ship_to_country, ship_to_location,
                requested_date, scheduled_ship_date, actual_ship_date,
                creation_date, last_update_date, source_line_update_date,
                integration_status_code, integration_status, inv_interfaced_flag_code,
                pending_quantity_flag, enforce_single_shipment, cancel_backorders,
                business_unit, legal_entity, created_by_fusion, last_updated_by_fusion,
                instance_name, wms_created_date, wms_created_by
            ) VALUES (
                v_shipment_line, v_order_number, v_order_line,
                v_order_type_code, v_order_type, v_order_schedule,
                v_source_order_id, v_source_order, v_source_order_line_id,
                v_source_order_line, v_source_order_fulfillment_line_id, v_source_order_fulfillment_line,
                v_inventory_item_id, v_item, v_item_description,
                v_requested_quantity, v_requested_quantity_uom_code, v_requested_quantity_uom,
                v_shipped_quantity, v_staged_quantity, v_picked_quantity,
                v_cancelled_quantity, v_backordered_quantity, v_converted_quantity,
                v_pending_quantity, v_source_requested_quantity,
                v_unit_price, v_selling_price, v_currency_code,
                v_shipment_id, v_shipment, v_shipment_status_code,
                v_line_status_code, v_line_status,
                v_pick_wave_id, v_pick_wave,
                v_movement_request_line_id, v_movement_request_number, v_movement_request_line_number,
                v_organization_id, v_organization_code, v_organization_name,
                v_subinventory, v_subinventory_name, v_source_subinventory, v_source_subinventory_name,
                v_lot_number,
                v_ship_to_party_id, v_ship_to_customer, v_ship_to_customer_number,
                v_ship_to_location_id, v_ship_to_address1, v_ship_to_address2,
                v_ship_to_city, v_ship_to_postal_code, v_ship_to_country, v_ship_to_location,
                v_requested_date, v_scheduled_ship_date, v_actual_ship_date,
                v_creation_date, v_last_update_date, v_source_line_update_date,
                v_integration_status_code, v_integration_status, v_inv_interfaced_flag_code,
                v_pending_quantity_flag, v_enforce_single_shipment, v_cancel_backorders,
                v_business_unit, v_legal_entity, v_created_by_fusion, v_last_updated_by_fusion,
                NVL(UPPER(p_instance_name), 'TEST'), SYSDATE, USER
            );
            v_count := v_count + 1;
        EXCEPTION
            WHEN OTHERS THEN NULL; -- skip bad rows, continue
        END;
    END LOOP;

    COMMIT;
    p_rows_inserted := v_count;
    p_result := 'SUCCESS';

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        p_result := 'ERROR: ' || SQLERRM;
        p_rows_inserted := 0;
END wms_save_shipment_lines;
/


-- ============================================================
-- STEP 3: GET PROCEDURE wms_get_shipment_lines
--         Returns stored shipment lines for a given order.
-- ============================================================
CREATE OR REPLACE PROCEDURE wms_get_shipment_lines (
    p_order_number  IN  VARCHAR2,
    p_instance_name IN  VARCHAR2 DEFAULT 'TEST',
    p_cursor        OUT SYS_REFCURSOR
) AS
BEGIN
    OPEN p_cursor FOR
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
        WHERE order_number  = p_order_number
          AND instance_name = NVL(UPPER(p_instance_name), 'TEST')
        ORDER BY shipment_line ASC;
END wms_get_shipment_lines;
/


-- ============================================================
-- STEP 4: APEX REST ENDPOINT SETUP
-- ============================================================
/*
Module:       TRIPMANAGEMENT  (existing module, base path already set)

--- POST: Save Shipment Lines ---
URI Template:     /orders/shipmentlines/save
HTTP Method:      POST
Source Type:      PL/SQL
Source:

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

    -- The items array is the full Fusion response body passed as-is
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


--- GET: Retrieve Saved Shipment Lines ---
URI Template:     /orders/shipmentlines/:orderNumber
HTTP Method:      GET
Source Type:      PL/SQL
Source:

BEGIN
    wms_get_shipment_lines(
        p_order_number  => :orderNumber,
        p_instance_name => NVL(:P_INSTANCE_NAME, 'TEST'),
        p_cursor        => :cursor
    );
END;

Query String Parameter:   P_INSTANCE_NAME  (optional, defaults to TEST)

Example call:
  POST  .../TRIPMANAGEMENT/orders/shipmentlines/save
  Body: { "orderNumber": "90105000006", "instanceName": "TEST", "items": [...] }

  GET   .../TRIPMANAGEMENT/orders/shipmentlines/90105000006?P_INSTANCE_NAME=TEST
*/


-- ============================================================
-- STEP 5: QUICK TEST
-- ============================================================
/*
-- Verify table created:
SELECT COUNT(*) FROM wms_order_shipment_lines;

-- Verify procedure compiles:
SELECT object_name, status FROM user_objects
WHERE object_name IN ('WMS_SAVE_SHIPMENT_LINES', 'WMS_GET_SHIPMENT_LINES');
*/
