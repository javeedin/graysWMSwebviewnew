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
    p_json_clob     IN CLOB,        -- full JSON body from Fusion (items array or wrapped)
    p_result        OUT VARCHAR2,
    p_rows_inserted OUT NUMBER
) AS
    v_items_json    CLOB;
    v_count         NUMBER := 0;
    v_item_count    NUMBER;

    -- Helper to get a number safely
    FUNCTION get_num(p_path IN VARCHAR2) RETURN NUMBER IS
    BEGIN
        RETURN APEX_JSON.get_number(p_path);
    EXCEPTION WHEN OTHERS THEN RETURN NULL;
    END;

    -- Helper to get varchar2 safely
    FUNCTION get_str(p_path IN VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        RETURN APEX_JSON.get_varchar2(p_path);
    EXCEPTION WHEN OTHERS THEN RETURN NULL;
    END;

    -- Helper to convert ISO8601 string to TIMESTAMP WITH TIME ZONE
    FUNCTION to_tstz(p_str IN VARCHAR2) RETURN TIMESTAMP WITH TIME ZONE IS
    BEGIN
        IF p_str IS NULL THEN RETURN NULL; END IF;
        RETURN TO_TIMESTAMP_TZ(p_str, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM');
    EXCEPTION WHEN OTHERS THEN RETURN NULL;
    END;

BEGIN
    p_rows_inserted := 0;

    -- Delete existing rows for this order + instance (full refresh)
    DELETE FROM wms_order_shipment_lines
    WHERE order_number  = p_order_number
      AND instance_name = NVL(p_instance_name, 'TEST');

    -- Parse incoming JSON
    APEX_JSON.parse(p_json_clob);

    -- Support both {"items":[...]} wrapper and plain array [...]
    BEGIN
        v_item_count := APEX_JSON.get_count('items');
    EXCEPTION WHEN OTHERS THEN
        v_item_count := 0;
    END;

    IF v_item_count IS NULL OR v_item_count = 0 THEN
        -- Try root array
        BEGIN
            v_item_count := APEX_JSON.get_count('.');
        EXCEPTION WHEN OTHERS THEN
            v_item_count := 0;
        END;
    END IF;

    FOR i IN 1..NVL(v_item_count, 0) LOOP
        DECLARE
            v_prefix VARCHAR2(20) := 'items[' || i || '].';
        BEGIN
            INSERT INTO wms_order_shipment_lines (
                shipment_line,
                order_number,
                order_line,
                order_type_code,
                order_type,
                order_schedule,
                source_order_id,
                source_order,
                source_order_line_id,
                source_order_line,
                source_order_fulfillment_line_id,
                source_order_fulfillment_line,
                inventory_item_id,
                item,
                item_description,
                requested_quantity,
                requested_quantity_uom_code,
                requested_quantity_uom,
                shipped_quantity,
                staged_quantity,
                picked_quantity,
                cancelled_quantity,
                backordered_quantity,
                converted_quantity,
                pending_quantity,
                source_requested_quantity,
                unit_price,
                selling_price,
                currency_code,
                shipment_id,
                shipment,
                shipment_status_code,
                line_status_code,
                line_status,
                pick_wave_id,
                pick_wave,
                movement_request_line_id,
                movement_request_number,
                movement_request_line_number,
                organization_id,
                organization_code,
                organization_name,
                subinventory,
                subinventory_name,
                source_subinventory,
                source_subinventory_name,
                lot_number,
                ship_to_party_id,
                ship_to_customer,
                ship_to_customer_number,
                ship_to_location_id,
                ship_to_address1,
                ship_to_address2,
                ship_to_city,
                ship_to_postal_code,
                ship_to_country,
                ship_to_location,
                requested_date,
                scheduled_ship_date,
                actual_ship_date,
                creation_date,
                last_update_date,
                source_line_update_date,
                integration_status_code,
                integration_status,
                inv_interfaced_flag_code,
                pending_quantity_flag,
                enforce_single_shipment,
                cancel_backorders,
                business_unit,
                legal_entity,
                created_by_fusion,
                last_updated_by_fusion,
                instance_name,
                wms_created_date,
                wms_created_by
            ) VALUES (
                get_num(v_prefix || 'ShipmentLine'),
                NVL(get_str(v_prefix || 'Order'), p_order_number),
                get_str(v_prefix || 'OrderLine'),
                get_str(v_prefix || 'OrderTypeCode'),
                get_str(v_prefix || 'OrderType'),
                get_str(v_prefix || 'OrderSchedule'),
                get_num(v_prefix || 'SourceOrderId'),
                get_str(v_prefix || 'SourceOrder'),
                get_num(v_prefix || 'SourceOrderLineId'),
                get_str(v_prefix || 'SourceOrderLine'),
                get_num(v_prefix || 'SourceOrderFulfillmentLineId'),
                get_str(v_prefix || 'SourceOrderFulfillmentLine'),
                get_num(v_prefix || 'InventoryItemId'),
                get_str(v_prefix || 'Item'),
                get_str(v_prefix || 'ItemDescription'),
                get_num(v_prefix || 'RequestedQuantity'),
                get_str(v_prefix || 'RequestedQuantityUOMCode'),
                get_str(v_prefix || 'RequestedQuantityUOM'),
                get_num(v_prefix || 'ShippedQuantity'),
                get_num(v_prefix || 'StagedQuantity'),
                get_num(v_prefix || 'PickedQuantity'),
                get_num(v_prefix || 'CancelledQuantity'),
                get_num(v_prefix || 'BackorderedQuantity'),
                get_num(v_prefix || 'ConvertedQuantity'),
                get_num(v_prefix || 'PendingQuantity'),
                get_num(v_prefix || 'SourceRequestedQuantity'),
                get_num(v_prefix || 'UnitPrice'),
                get_num(v_prefix || 'SellingPrice'),
                get_str(v_prefix || 'CurrencyCode'),
                get_num(v_prefix || 'ShipmentId'),
                get_str(v_prefix || 'Shipment'),
                get_str(v_prefix || 'ShipmentStatusCode'),
                get_str(v_prefix || 'LineStatusCode'),
                get_str(v_prefix || 'LineStatus'),
                get_num(v_prefix || 'PickWaveId'),
                get_str(v_prefix || 'PickWave'),
                get_num(v_prefix || 'MovementRequestLineId'),
                get_str(v_prefix || 'MovementRequestNumber'),
                get_str(v_prefix || 'MovementRequestLineNumber'),
                get_num(v_prefix || 'OrganizationId'),
                get_str(v_prefix || 'OrganizationCode'),
                get_str(v_prefix || 'OrganizationName'),
                get_str(v_prefix || 'Subinventory'),
                get_str(v_prefix || 'SubinventoryName'),
                get_str(v_prefix || 'SourceSubinventory'),
                get_str(v_prefix || 'SourceSubinventoryName'),
                get_str(v_prefix || 'LotNumber'),
                get_num(v_prefix || 'ShipToPartyId'),
                get_str(v_prefix || 'ShipToCustomer'),
                get_str(v_prefix || 'ShipToCustomerNumber'),
                get_num(v_prefix || 'ShipToLocationId'),
                get_str(v_prefix || 'ShipToAddress1'),
                get_str(v_prefix || 'ShipToAddress2'),
                get_str(v_prefix || 'ShipToCity'),
                get_str(v_prefix || 'ShipToPostalCode'),
                get_str(v_prefix || 'ShipToCountry'),
                get_str(v_prefix || 'ShipToLocation'),
                to_tstz(get_str(v_prefix || 'RequestedDate')),
                to_tstz(get_str(v_prefix || 'ScheduledShipDate')),
                to_tstz(get_str(v_prefix || 'ActualShipDate')),
                to_tstz(get_str(v_prefix || 'CreationDate')),
                to_tstz(get_str(v_prefix || 'LastUpdateDate')),
                to_tstz(get_str(v_prefix || 'SourceLineUpdateDate')),
                get_str(v_prefix || 'IntegrationStatusCode'),
                get_str(v_prefix || 'IntegrationStatus'),
                get_str(v_prefix || 'InvInterfacedFlagCode'),
                CASE WHEN get_str(v_prefix || 'PendingQuantityFlag') = 'true' THEN 'Y' ELSE 'N' END,
                get_str(v_prefix || 'EnforceSingleShipment'),
                get_str(v_prefix || 'CancelBackorders'),
                get_str(v_prefix || 'BusinessUnit'),
                get_str(v_prefix || 'LegalEntity'),
                get_str(v_prefix || 'CreatedBy'),
                get_str(v_prefix || 'LastUpdatedBy'),
                NVL(UPPER(p_instance_name), 'TEST'),
                SYSDATE,
                USER
            );
            v_count := v_count + 1;
        EXCEPTION
            WHEN OTHERS THEN
                -- Skip bad rows, continue
                NULL;
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
