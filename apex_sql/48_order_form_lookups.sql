-- ============================================================
-- WMS AI DIGITAL EMPLOYEE - ORDER FORM SELF-LOADED LOOKUPS
-- ============================================================
-- The Order Entry dialog now self-loads pickers and rules from
-- the order.creation row's LOOKUPS column (a JSON object with
-- the same keys as the form's _lookups). Precedence when the
-- form opens: pinned WMS_ORDER_LOOKUPS > what the bot supplied
-- > this JSON (fills the gaps only).
--
-- This makes the fast-path "open create order form" prompt open
-- in ONE model reply, with dropdowns, item search and trained
-- rules loaded by the form itself - zero extra model rounds.
--
-- JSON keys the form understands:
--   customersSql       :SEARCH placeholder, aliases ACCOUNT_NAME,
--                      BILL_TO_CUSTOMER_NUMBER, CUST_ACCOUNT_ID, PARTY_ID,
--                      SITE_USE_ID, PARTY_SITE_ID, PRICELIST, LOCATION
--   itemsSql           :SEARCH + :PRICELIST, aliases ITEM_CODE, ITEM_DESC,
--                      LIST_PRICE, TAX_CODE, TAX_RATE, UOM, INVENTORY_ITEM_ID
--   salesrepsSql       aliases SALESREP_NUMBER, SALESREP_NAME
--   orderTypesSql      alias ORDER_TYPE
--   warehousesSql      alias WAREHOUSE
--   subinventoriesSql  alias SUBINVENTORY
--   lineRulesSql       :ITEM_CODE (parent item), aliases ITEM_CODE (companion),
--                      ITEM_DESC, BUY_QTY, GET_QTY, PRICE, TAX_CODE
--                      (optional TAX_RATE, UOM, INVENTORY_ITEM_ID)
--   submitChecks       [ { "sql", "message", "mode" } ]
--                      mode FAIL_IF_ROWS (rows = violations) or
--                      FAIL_IF_NO_ROWS (a row is required to pass)
-- Header placeholders available in lineRulesSql/submitChecks:
--   :CUSTOMER :PRICELIST :ORDER_TYPE :ORDER_DATE :WAREHOUSE
-- (the form substitutes them as quoted literals from the live header)
--
-- BEFORE RUNNING: fill in the real table/column names where marked
-- <TODO>. The item/price-list, salesrep, order-type, warehouse and
-- BOGO column names were not confirmed in this repo - check the
-- schema catalog (or ask the AI Digital Employee, e.g. "show me the
-- columns of FUSION_BOGO_ITEMS"). Alternatively, skip this script
-- and use the Teach box in the Processes tab:
--   "store the order form lookups: items come from <table>, bogo
--    rules from FUSION_BOGO_ITEMS, salesreps from <table>..."
-- - the bot builds and applies this same UPDATE for you (approval
-- card), which keeps LOOKUPS as valid JSON.
--
-- Run in SQL Workshop > SQL Commands.
-- ============================================================

UPDATE wms_ai_processes
   SET lookups = '{
  "customersSql": "SELECT ACCOUNT_NAME, ACCOUNT_NUMBER AS BILL_TO_CUSTOMER_NUMBER, CUST_ACCOUNT_ID, PARTY_ID, BILL_TO_SITE_USE_ID AS SITE_USE_ID, SHIP_TO_PARTY_SITE_ID AS PARTY_SITE_ID, PRICE_LIST AS PRICELIST, CITY AS LOCATION FROM GRFU_CUSTOMER WHERE (UPPER(ACCOUNT_NAME) LIKE :SEARCH OR UPPER(ACCOUNT_NUMBER) LIKE :SEARCH) ORDER BY ACCOUNT_NAME FETCH FIRST 50 ROWS ONLY",
  "itemsSql": "SELECT <item_code_col> AS ITEM_CODE, <item_desc_col> AS ITEM_DESC, <list_price_col> AS LIST_PRICE, <tax_code_col> AS TAX_CODE, <tax_rate_col> AS TAX_RATE, <uom_col> AS UOM, <inventory_item_id_col> AS INVENTORY_ITEM_ID FROM <price_list_items_table> WHERE <price_list_name_col> = :PRICELIST AND (UPPER(<item_code_col>) LIKE :SEARCH OR UPPER(<item_desc_col>) LIKE :SEARCH) ORDER BY <item_code_col> FETCH FIRST 50 ROWS ONLY",
  "salesrepsSql": "SELECT DISTINCT <salesrep_number_col> AS SALESREP_NUMBER, <salesrep_name_col> AS SALESREP_NAME FROM <salesreps_table> ORDER BY 2",
  "orderTypesSql": "SELECT DISTINCT <order_type_col> AS ORDER_TYPE FROM <order_types_table> ORDER BY 1",
  "warehousesSql": "SELECT DISTINCT <warehouse_col> AS WAREHOUSE FROM <warehouses_table> ORDER BY 1",
  "subinventoriesSql": "SELECT DISTINCT <subinventory_col> AS SUBINVENTORY FROM <subinventories_table> ORDER BY 1",
  "lineRulesSql": "SELECT <promo_item_col> AS ITEM_CODE, <promo_desc_col> AS ITEM_DESC, <buy_qty_col> AS BUY_QTY, <get_qty_col> AS GET_QTY, <promo_price_col> AS PRICE, <vat_code_col> AS TAX_CODE FROM fusion_bogo_items WHERE <main_item_col> = :ITEM_CODE AND TRUNC(SYSDATE) BETWEEN <start_date_col> AND <end_date_col>",
  "submitChecks": [
    { "sql": "SELECT 1 FROM grfu_customer WHERE account_number = :CUSTOMER AND UPPER(NVL(status,''ACTIVE'')) LIKE ''A%''",
      "message": "Customer is not active - order blocked.",
      "mode": "FAIL_IF_NO_ROWS" }
  ]
}',
       updated_by = 'SCRIPT-48',
       updated_on = SYSDATE
 WHERE process_key = 'order.creation';

COMMIT;

-- ============================================================
-- VERIFY: the form logs "[OrderEntry] self-loaded from process
-- row: ..." in the WebView console on next open. Check the JSON
-- parses (bad JSON is ignored with a console warning):
--   SELECT lookups FROM wms_ai_processes WHERE process_key = 'order.creation';
-- ============================================================
