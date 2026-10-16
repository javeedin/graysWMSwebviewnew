-- ============================================================
-- UPDATE: getpickreleasedetails endpoint
-- Module  : TRIPMANAGEMENT
-- Template: trips/orders/getpickreleasedetails/{ORDER_NUMBER}
-- Method  : GET
-- Source  : Query (or Collection Query)
-- Params  : ORDER_NUMBER (URI), P_INSTANCE_NAME (Query)
--
-- Change  : LEFT JOIN WMS_TRIP_DETAILS so that TRIP_ID,
--           ACCOUNT_NAME, RELEASE_DATE and ORDER_TYPE are
--           included in every row returned by the endpoint.
-- ============================================================

-- Paste this SQL into the GET handler source in APEX RESTful Services:

SELECT
    p.PICK_CONFIRM_ST,
    p.TRANSACTION_ID,
    p.PICK_SLIP,
    p.PICK_SLIP_LINE,
    p.ITEM,
    i.DESCRIPTION,
    p.REQUESTED_QUANTITY,
    p.SOURCE_ORDER,
    p.SOURCE_ORDER_LINE,
    p.DESTINATION_SUBINVENTORY,
    p.SOURCE_SUBINVENTORY,
    p.UOM,
    p.MOVEMENT_REQUEST,
    p.SHIP_TO_LOCATION,
    p.CUSTOMER,
    p.TRANSACTION_TYPE,
    p.FULL_JSON,
    p.DATE_LOADED,
    t.TRIP_ID,
    t.ACCOUNT_NAME,
    t.RELEASE_DATE,
    t.ORDER_TYPE
FROM WMS_FUSION_PICKSLIP_DETAILS p
JOIN  GRFU_ITEM i  ON i.ITEM_NUMBER = p.ITEM
LEFT JOIN (
    -- Use a subquery to guarantee at most one trip row per order,
    -- avoiding row-multiplication if WMS_TRIP_DETAILS ever has
    -- more than one record for the same ORDER_NUMBER.
    SELECT TRIP_ID, ACCOUNT_NAME, RELEASE_DATE, ORDER_TYPE, ORDER_NUMBER
    FROM   WMS_TRIP_DETAILS
    WHERE  ORDER_NUMBER = :ORDER_NUMBER
    AND    ROWNUM = 1
) t ON t.ORDER_NUMBER = p.SOURCE_ORDER
WHERE p.SOURCE_ORDER    = :ORDER_NUMBER
AND   p.INSTANCE_NAME   = NVL(:P_INSTANCE_NAME, p.INSTANCE_NAME)
