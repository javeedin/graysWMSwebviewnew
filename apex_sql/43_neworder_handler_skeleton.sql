-- ============================================================
-- WMS ORDER CREATION - NEWORDER REST HANDLER (skeleton)
-- ============================================================
-- Receives the sales order composed in the AI chat's order.create
-- form (or any caller) and stores it in the APEX DB; a separate
-- procedure interfaces stored orders to Fusion.
--
-- In APEX RESTful Services:
--   Module:        ORDERCRATION        (as referenced by the app)
--   URI Template:  NEWORDER
--   Method:        POST
--   Source Type:   PL/SQL
--
-- JSON body contract (exactly what the app's form POSTs):
-- {
--   "customer_account": "10021",
--   "customer_name":    "ABC Traders Ltd",
--   "order_type":       "STANDARD",
--   "salesrep_name":    "J Doe",
--   "order_date":       "2026-09-13",
--   "po_number":        "PO-4471",
--   "notes":            "",
--   "instance_name":    "PROD",
--   "lines": [
--     { "item_code": "10023", "item_description": "Item X", "quantity": 5, "uom": "Ea" }
--   ]
-- }
--
-- TODO: replace the staging table names/columns with your real
-- order tables before creating the handler.
-- ============================================================

DECLARE
    v_body        CLOB;
    v_header_id   NUMBER;
    v_line_count  PLS_INTEGER;
BEGIN
    v_body := :body_text;
    APEX_JSON.parse(v_body);

    -- ── Header ─────────────────────────────────────────────
    INSERT INTO wms_order_headers_stg (          -- TODO real table
        customer_account, customer_name, order_type, salesrep_name,
        order_date, po_number, notes, instance_name,
        status, created_on, created_by
    ) VALUES (
        APEX_JSON.get_varchar2('customer_account'),
        APEX_JSON.get_varchar2('customer_name'),
        APEX_JSON.get_varchar2('order_type'),
        APEX_JSON.get_varchar2('salesrep_name'),
        TO_DATE(APEX_JSON.get_varchar2('order_date'), 'YYYY-MM-DD'),
        APEX_JSON.get_varchar2('po_number'),
        APEX_JSON.get_varchar2('notes'),
        NVL(APEX_JSON.get_varchar2('instance_name'), 'TEST'),
        'NEW', SYSDATE, NVL(v('APP_USER'), USER)
    ) RETURNING header_id INTO v_header_id;      -- TODO real PK column

    -- ── Lines ──────────────────────────────────────────────
    v_line_count := NVL(APEX_JSON.get_count('lines'), 0);
    FOR i IN 1 .. v_line_count LOOP
        INSERT INTO wms_order_lines_stg (        -- TODO real table
            header_id, line_number, item_code, item_description,
            quantity, uom
        ) VALUES (
            v_header_id, i,
            APEX_JSON.get_varchar2('lines[%d].item_code', i),
            APEX_JSON.get_varchar2('lines[%d].item_description', i),
            APEX_JSON.get_number('lines[%d].quantity', i),
            APEX_JSON.get_varchar2('lines[%d].uom', i)
        );
    END LOOP;

    COMMIT;

    APEX_JSON.open_object;
    APEX_JSON.write('success',   TRUE);
    APEX_JSON.write('headerId',  v_header_id);
    APEX_JSON.write('lineCount', v_line_count);
    APEX_JSON.write('status',    'NEW - awaiting Fusion interface');
    APEX_JSON.close_object;
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        APEX_JSON.open_object;
        APEX_JSON.write('success', FALSE);
        APEX_JSON.write('error',   SQLERRM);
        APEX_JSON.close_object;
END;
