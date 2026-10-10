-- ============================================================
-- APEX REST HANDLER — GET trip/orders/getsalesorderlinesbytrip/:tripId
-- ============================================================
-- Module:       TRIPMANAGEMENT
-- URI Template: trip/orders/getsalesorderlinesbytrip/:tripId
-- Method:       GET
-- Source Type:  SQL Query
-- URI Bind:     :tripId          (VARCHAR2)
-- Query Params: :P_INSTANCE_NAME (VARCHAR2, optional)
--               :P_CANCEL_ONLY   (VARCHAR2, optional — pass 'Y' to return
--                                 only lines with status Scheduled or
--                                 Manual Reservation Required)
-- ============================================================
-- Returns sales order lines for every order in the given trip.
-- Pass P_CANCEL_ONLY=Y to pre-filter to cancellable lines only.
-- Used by Shipping Agents "Cancel Orders" button.
-- ============================================================
SELECT
    sol.TRIP_ID,
    sol.SOURCE_ORDER_NUMBER,
    sol.LINE_NUMBER,
    sol.STATUS,
    sol.STATUS_CODE,
    sol.PRODUCT_NUMBER,
    sol.PRODUCT_DESCRIPTION,
    sol.ORDERED_QUANTITY,
    sol.RESERVED_QUANTITY,
    sol.EXTENDED_AMOUNT,
    sol.TRANSACTION_CATEGORY_CODE,
    sol.REQ_FULFILL_ORG_CODE,
    sol.FULFILL_LINE_ID,
    (SELECT DISTINCT d.CANCEL_STATUS
       FROM WMS_PICK_SLIP_LOT_DETAILS d
      WHERE d.SOURCE_ORDER = sol.SOURCE_ORDER_NUMBER
        AND d.ITEM         = sol.PRODUCT_NUMBER
        AND ROWNUM < 2)    AS CANCEL_STATUS,
    sol.HOLD_FLAG,
    sol.INSTANCE_NAME
FROM WMS_V_SALES_ORDER_LINES sol
WHERE sol.TRIP_ID       = :tripId
  AND sol.INSTANCE_NAME = NVL(:P_INSTANCE_NAME, sol.INSTANCE_NAME)
  AND (   :P_CANCEL_ONLY IS NULL
       OR :P_CANCEL_ONLY <> 'Y'
       OR UPPER(sol.STATUS) LIKE '%SCHEDULED%'
       OR UPPER(sol.STATUS) LIKE '%MANUAL RESERVATION%')
ORDER BY sol.SOURCE_ORDER_NUMBER, sol.LINE_NUMBER


-- ============================================================
-- VARIANT: Only return lines needing cancellation
-- (use this as an alternative handler if you want pre-filtered results)
-- URI Template: trip/orders/getcancellines/:tripId
-- ============================================================
/*
SELECT
    sol.TRIP_ID,
    sol.SOURCE_ORDER_NUMBER,
    sol.LINE_NUMBER,
    sol.STATUS,
    sol.STATUS_CODE,
    sol.PRODUCT_NUMBER,
    sol.PRODUCT_DESCRIPTION,
    sol.ORDERED_QUANTITY,
    sol.RESERVED_QUANTITY,
    sol.FULFILL_LINE_ID,
    sol.HOLD_FLAG,
    sol.INSTANCE_NAME
FROM WMS_V_SALES_ORDER_LINES sol
WHERE sol.TRIP_ID       = :tripId
  AND sol.INSTANCE_NAME = NVL(:P_INSTANCE_NAME, sol.INSTANCE_NAME)
  AND (  UPPER(sol.STATUS) LIKE '%SCHEDULED%'
      OR UPPER(sol.STATUS) LIKE '%MANUAL RESERVATION%')
ORDER BY sol.SOURCE_ORDER_NUMBER, sol.LINE_NUMBER
*/
