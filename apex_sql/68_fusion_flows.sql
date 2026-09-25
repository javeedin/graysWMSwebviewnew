-- ============================================================
-- 68_fusion_flows.sql
-- Fusion SQL › Flows: process flows (e.g. Order to Cash) that follow
-- ONE document through Fusion as a chain of small read-only SQL steps.
-- The Flows tab creates these tables itself (via ai/executewrite) and
-- has a "Starter flows" button — run this script only to set them up
-- by hand. Safe to re-run: tables are created only if missing and a
-- starter flow is inserted only when no flow has that name.
--
-- Step SQL placeholders (resolved by the page at run time):
--   {{P_ORDER_NUMBER}}   flow parameter typed by the user
--   {{HEADER_ID}}        values of a column an earlier step hands on (outputs)
--   {{TRANSACTION_ID:str}} same, as quoted strings (VARCHAR2 targets)
-- ============================================================

DECLARE
    PROCEDURE ddl(p_table VARCHAR2, p_sql VARCHAR2) IS
        n NUMBER;
    BEGIN
        SELECT COUNT(*) INTO n FROM user_tables WHERE table_name = p_table;
        IF n = 0 THEN EXECUTE IMMEDIATE p_sql; END IF;
    END;
    PROCEDURE idx(p_index VARCHAR2, p_sql VARCHAR2) IS
        n NUMBER;
    BEGIN
        SELECT COUNT(*) INTO n FROM user_indexes WHERE index_name = p_index;
        IF n = 0 THEN EXECUTE IMMEDIATE p_sql; END IF;
    END;
BEGIN
    ddl('WMS_FUSION_FLOWS', q'[CREATE TABLE wms_fusion_flows (
        flow_id      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        flow_name    VARCHAR2(200) NOT NULL,
        description  VARCHAR2(2000),
        params_json  VARCHAR2(4000),      -- [{"name":"P_ORDER_NUMBER","label":"Sales order number"}]
        summary_json VARCHAR2(4000),      -- headline figures: [{"label","step","column"} | {"label","expr","fmt"}]
        source       VARCHAR2(10) DEFAULT 'USER',   -- USER | AI | SEED
        created_by   VARCHAR2(120),
        created_date DATE DEFAULT SYSDATE,
        updated_by   VARCHAR2(120),
        updated_date DATE)]');
    idx('WMS_FUSION_FLOWS_NAME_UX', 'CREATE UNIQUE INDEX wms_fusion_flows_name_ux ON wms_fusion_flows (UPPER(flow_name))');

    ddl('WMS_FUSION_FLOW_STEPS', q'[CREATE TABLE wms_fusion_flow_steps (
        step_id     NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        flow_id     NUMBER NOT NULL,
        step_no     NUMBER NOT NULL,         -- display / run order
        step_key    VARCHAR2(30) NOT NULL,   -- S1, S2 … (referenced by parents / summary)
        step_name   VARCHAR2(200) NOT NULL,
        module      VARCHAR2(20),            -- OM WSH INV CST XLA AR AP PO RCV GL OTHER
        parents     VARCHAR2(400),           -- comma list of step keys (diagram arrows)
        outputs     VARCHAR2(1000),          -- comma list of columns handed to later steps
        measure_col VARCHAR2(128),           -- optional amount column totalled on the diagram
        hint        VARCHAR2(1000),          -- what 0 rows at this step means
        sql_text    CLOB NOT NULL)]');
    idx('WMS_FUSION_FLOW_STEPS_FX', 'CREATE INDEX wms_fusion_flow_steps_fx ON wms_fusion_flow_steps (flow_id, step_no)');

    ddl('WMS_FUSION_FLOW_RUNS', q'[CREATE TABLE wms_fusion_flow_runs (
        run_id      NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        flow_id     NUMBER NOT NULL,
        params_json VARCHAR2(2000),
        instance    VARCHAR2(10),
        run_by      VARCHAR2(120),
        run_date    DATE DEFAULT SYSDATE,
        status      VARCHAR2(20),            -- COMPLETE | STOPPED
        stopped_at  VARCHAR2(300),           -- first step with no rows / no input / error
        step_counts VARCHAR2(4000),          -- {"S1":1,"S2":4,"S3":"empty",…}
        elapsed_ms  NUMBER)]');
    idx('WMS_FUSION_FLOW_RUNS_FX', 'CREATE INDEX wms_fusion_flow_runs_fx ON wms_fusion_flow_runs (flow_id, run_date)');
END;
/

-- ── Starter flows ────────────────────────────────────────────
DECLARE
    v_id NUMBER;
    v_n  NUMBER;
BEGIN
    SELECT COUNT(*) INTO v_n FROM wms_fusion_flows WHERE UPPER(flow_name) = UPPER(q'[Order to Cash (OTC)]');
    IF v_n = 0 THEN
        INSERT INTO wms_fusion_flows (flow_name, description, params_json, summary_json, source, created_by)
        VALUES (q'[Order to Cash (OTC)]', q'[Follows one sales order: order → fulfillment lines → shipment → inventory issue → cost/COGS → AR invoice → revenue distributions → subledger accounting → customer receipts. Shows where the order stopped and the margin.]',
                q'[[{"name":"P_ORDER_NUMBER","label":"Sales order number","sample":""}]]',
                q'[[{"label":"Ordered","step":"S2","column":"EXTENDED_AMOUNT"},{"label":"Invoiced","step":"S6","column":"EXTENDED_AMOUNT"},{"label":"Revenue","step":"S7","column":"REVENUE_AMOUNT"},{"label":"COGS","step":"S5","column":"COGS_AMOUNT"},{"label":"Margin","expr":"Revenue - COGS"},{"label":"Margin %","expr":"(Revenue - COGS) / Revenue * 100","fmt":"pct"},{"label":"Received","step":"S9","column":"AMOUNT_APPLIED"}]]', 'SEED', 'SEED')
        RETURNING flow_id INTO v_id;
        INSERT INTO wms_fusion_flow_steps (flow_id, step_no, step_key, step_name, module, parents, outputs, measure_col, hint, sql_text)
        VALUES (v_id, 1, 'S1', q'[Sales order]', 'OM', '', 'HEADER_ID', '',
                q'[No submitted order with this number — check the order number (source order numbers are not the Fusion order number).]',
                q'[SELECT h.header_id, h.order_number, h.source_order_number, h.status_code, h.ordered_date,
       h.transactional_currency_code AS currency, p.party_name AS customer, h.org_id AS bu_id
FROM   fusion.doo_headers_all h
LEFT JOIN fusion.hz_parties p ON p.party_id = h.sold_to_party_id
WHERE  h.order_number = TO_CHAR({{P_ORDER_NUMBER}})
AND    h.submitted_flag = 'Y']');
        INSERT INTO wms_fusion_flow_steps (flow_id, step_no, step_key, step_name, module, parents, outputs, measure_col, hint, sql_text)
        VALUES (v_id, 2, 'S2', q'[Fulfillment lines]', 'OM', 'S1', 'FULFILL_LINE_ID', 'EXTENDED_AMOUNT',
                q'[The order has no fulfillment lines — it may not be submitted to fulfillment yet.]',
                q'[SELECT fl.fulfill_line_id, fl.fulfill_line_number, fl.status_code, fl.inventory_item_id,
       i.item_number, fl.ordered_qty, fl.shipped_qty, fl.unit_selling_price, fl.extended_amount,
       fl.fulfill_org_id, fl.request_ship_date, fl.actual_ship_date
FROM   fusion.doo_fulfill_lines_all fl
LEFT JOIN fusion.egp_system_items_b i ON i.inventory_item_id = fl.inventory_item_id AND i.organization_id = fl.fulfill_org_id
WHERE  fl.header_id IN ({{HEADER_ID}})
ORDER BY fl.fulfill_line_number]');
        INSERT INTO wms_fusion_flow_steps (flow_id, step_no, step_key, step_name, module, parents, outputs, measure_col, hint, sql_text)
        VALUES (v_id, 3, 'S3', q'[Shipment]', 'WSH', 'S2', 'DELIVERY_DETAIL_ID,DELIVERY_ID', '',
                q'[Not interfaced to shipping yet — check the fulfillment line status / orchestration process.]',
                q'[SELECT wdd.delivery_detail_id, wdd.released_status, wdd.requested_quantity, wdd.shipped_quantity,
       wda.delivery_id, wnd.name AS delivery_name, wnd.status_code AS delivery_status,
       wnd.initial_pickup_date AS ship_date, wdd.organization_id
FROM   fusion.wsh_delivery_details wdd
LEFT JOIN fusion.wsh_delivery_assignments wda ON wda.delivery_detail_id = wdd.delivery_detail_id
LEFT JOIN fusion.wsh_new_deliveries wnd ON wnd.delivery_id = wda.delivery_id
WHERE  wdd.source_shipment_id IN ({{FULFILL_LINE_ID}})]');
        INSERT INTO wms_fusion_flow_steps (flow_id, step_no, step_key, step_name, module, parents, outputs, measure_col, hint, sql_text)
        VALUES (v_id, 4, 'S4', q'[Inventory issue]', 'INV', 'S3', 'TRANSACTION_ID', '',
                q'[Shipped lines but no inventory transaction — ship confirm may not be complete, or the transaction is still in the interface.]',
                q'[SELECT mt.transaction_id, mt.transaction_date, mt.transaction_type_id, mt.inventory_item_id,
       mt.organization_id, mt.subinventory_code, mt.transaction_quantity, mt.transaction_uom
FROM   fusion.inv_material_txns mt
WHERE  mt.trx_source_line_id IN ({{FULFILL_LINE_ID}})
ORDER BY mt.transaction_date]');
        INSERT INTO wms_fusion_flow_steps (flow_id, step_no, step_key, step_name, module, parents, outputs, measure_col, hint, sql_text)
        VALUES (v_id, 5, 'S5', q'[Cost / COGS]', 'CST', 'S4', 'COST_TRANSACTION_ID', 'COGS_AMOUNT',
                q'[Inventory moved but not costed — run Transfer Transactions from Inventory to Costing, then Create Cost Accounting Distributions.]',
                q'[SELECT ct.transaction_id AS cost_transaction_id, cit.cst_inv_transaction_id, cit.external_system_ref_id AS inv_transaction_id,
       ccd.distribution_id, ccdl.line_type, ccdl.accounted_amount,
       CASE WHEN UPPER(ccdl.line_type) LIKE '%COGS%' THEN ccdl.accounted_amount END AS cogs_amount
FROM   fusion.cst_inv_transactions cit
JOIN   fusion.cst_transactions ct ON ct.cst_inv_transaction_id = cit.cst_inv_transaction_id
LEFT JOIN fusion.cst_cost_distributions ccd ON ccd.transaction_id = ct.transaction_id
LEFT JOIN fusion.cst_cost_distribution_lines ccdl ON ccdl.distribution_id = ccd.distribution_id
WHERE  cit.external_system_ref_id IN ({{TRANSACTION_ID:str}})]');
        INSERT INTO wms_fusion_flow_steps (flow_id, step_no, step_key, step_name, module, parents, outputs, measure_col, hint, sql_text)
        VALUES (v_id, 6, 'S6', q'[AR invoice]', 'AR', 'S2', 'CUSTOMER_TRX_ID', 'EXTENDED_AMOUNT',
                q'[No receivables invoice — run Import AutoInvoice (and check the AR interface for errors).]',
                q'[SELECT rct.customer_trx_id, rct.trx_number, rct.trx_date, rct.complete_flag, rctl.line_number,
       rctl.line_type, rctl.description, rctl.quantity_invoiced, rctl.unit_selling_price, rctl.extended_amount
FROM   fusion.ra_customer_trx_lines_all rctl
JOIN   fusion.ra_customer_trx_all rct ON rct.customer_trx_id = rctl.customer_trx_id
WHERE  rctl.sales_order = TO_CHAR({{P_ORDER_NUMBER}})
ORDER BY rct.trx_number, rctl.line_number]');
        INSERT INTO wms_fusion_flow_steps (flow_id, step_no, step_key, step_name, module, parents, outputs, measure_col, hint, sql_text)
        VALUES (v_id, 7, 'S7', q'[Revenue distributions]', 'AR', 'S6', '', 'REVENUE_AMOUNT',
                q'[The invoice has no distributions — it may be incomplete.]',
                q'[SELECT gld.cust_trx_line_gl_dist_id, gld.account_class, gld.gl_date, gld.amount, gld.acctd_amount,
       CASE WHEN gld.account_class = 'REV' THEN gld.acctd_amount END AS revenue_amount,
       gld.code_combination_id, gld.posting_control_id
FROM   fusion.ra_cust_trx_line_gl_dist_all gld
WHERE  gld.customer_trx_id IN ({{CUSTOMER_TRX_ID}})
ORDER BY gld.account_class]');
        INSERT INTO wms_fusion_flow_steps (flow_id, step_no, step_key, step_name, module, parents, outputs, measure_col, hint, sql_text)
        VALUES (v_id, 8, 'S8', q'[AR accounting (SLA)]', 'XLA', 'S7', 'AE_HEADER_ID', '',
                q'[Not accounted yet — run Create Receivables Accounting.]',
                q'[SELECT xah.ae_header_id, xah.event_type_code, xah.accounting_date, xah.accounting_entry_status_code AS entry_status,
       xah.gl_transfer_status_code AS gl_transfer, xal.ae_line_num, xal.accounting_class_code,
       xal.accounted_dr, xal.accounted_cr, xal.code_combination_id
FROM   fusion.xla_transaction_entities xte
JOIN   fusion.xla_ae_headers xah ON xah.entity_id = xte.entity_id AND xah.application_id = xte.application_id
JOIN   fusion.xla_ae_lines xal ON xal.ae_header_id = xah.ae_header_id AND xal.application_id = xah.application_id
WHERE  xte.application_id = 222 AND xte.entity_code = 'TRANSACTIONS'
AND    xte.source_id_int_1 IN ({{CUSTOMER_TRX_ID}})
ORDER BY xah.ae_header_id, xal.ae_line_num]');
        INSERT INTO wms_fusion_flow_steps (flow_id, step_no, step_key, step_name, module, parents, outputs, measure_col, hint, sql_text)
        VALUES (v_id, 9, 'S9', q'[Customer receipts]', 'AR', 'S6', 'CASH_RECEIPT_ID', 'AMOUNT_APPLIED',
                q'[The invoice is not paid yet (no applied receipt).]',
                q'[SELECT ara.cash_receipt_id, acr.receipt_number, acr.receipt_date, ara.apply_date, ara.gl_date,
       ara.status, ara.amount_applied
FROM   fusion.ar_receivable_applications_all ara
JOIN   fusion.ar_cash_receipts_all acr ON acr.cash_receipt_id = ara.cash_receipt_id
WHERE  ara.applied_customer_trx_id IN ({{CUSTOMER_TRX_ID}})
AND    ara.status = 'APP']');
    END IF;
    COMMIT;
END;
/

DECLARE
    v_id NUMBER;
    v_n  NUMBER;
BEGIN
    SELECT COUNT(*) INTO v_n FROM wms_fusion_flows WHERE UPPER(flow_name) = UPPER(q'[Procure to Pay (P2P)]');
    IF v_n = 0 THEN
        INSERT INTO wms_fusion_flows (flow_name, description, params_json, summary_json, source, created_by)
        VALUES (q'[Procure to Pay (P2P)]', q'[Follows one purchase order: PO → lines/schedules → receipts → receipt accounting → supplier invoice → payables accounting → payments.]',
                q'[[{"name":"P_PO_NUMBER","label":"Purchase order number","sample":""}]]',
                q'[[{"label":"PO amount","step":"S2","column":"LINE_AMOUNT"},{"label":"Invoiced","step":"S5","column":"LINE_AMOUNT"},{"label":"Paid","step":"S7","column":"AMOUNT_PAID"},{"label":"Open to pay","expr":"Invoiced - Paid"}]]', 'SEED', 'SEED')
        RETURNING flow_id INTO v_id;
        INSERT INTO wms_fusion_flow_steps (flow_id, step_no, step_key, step_name, module, parents, outputs, measure_col, hint, sql_text)
        VALUES (v_id, 1, 'S1', q'[Purchase order]', 'PO', '', 'PO_HEADER_ID', '',
                q'[No PO with this number.]',
                q'[SELECT ph.po_header_id, ph.segment1 AS po_number, ph.document_status, ph.type_lookup_code,
       ph.currency_code, hp.party_name AS supplier, ph.creation_date, ph.prc_bu_id
FROM   fusion.po_headers_all ph
LEFT JOIN fusion.poz_suppliers s ON s.vendor_id = ph.vendor_id
LEFT JOIN fusion.hz_parties hp ON hp.party_id = s.party_id
WHERE  ph.segment1 = TO_CHAR({{P_PO_NUMBER}})]');
        INSERT INTO wms_fusion_flow_steps (flow_id, step_no, step_key, step_name, module, parents, outputs, measure_col, hint, sql_text)
        VALUES (v_id, 2, 'S2', q'[Lines & schedules]', 'PO', 'S1', 'PO_LINE_ID,LINE_LOCATION_ID', 'LINE_AMOUNT',
                q'[The PO has no lines.]',
                q'[SELECT pl.po_line_id, pl.line_num, pl.item_id, pl.item_description, pl.quantity, pl.unit_price,
       pl.quantity * pl.unit_price AS line_amount, pll.line_location_id, pll.quantity_received,
       pll.quantity_billed, pll.need_by_date
FROM   fusion.po_lines_all pl
LEFT JOIN fusion.po_line_locations_all pll ON pll.po_line_id = pl.po_line_id
WHERE  pl.po_header_id IN ({{PO_HEADER_ID}})
ORDER BY pl.line_num]');
        INSERT INTO wms_fusion_flow_steps (flow_id, step_no, step_key, step_name, module, parents, outputs, measure_col, hint, sql_text)
        VALUES (v_id, 3, 'S3', q'[Receipts]', 'RCV', 'S2', 'RCV_TRANSACTION_ID', '',
                q'[Nothing received against this PO yet.]',
                q'[SELECT rt.transaction_id AS rcv_transaction_id, rsh.receipt_num, rt.transaction_type, rt.transaction_date,
       rt.quantity, rt.po_unit_price, rt.destination_type_code
FROM   fusion.rcv_transactions rt
LEFT JOIN fusion.rcv_shipment_headers rsh ON rsh.shipment_header_id = rt.shipment_header_id
WHERE  rt.po_line_location_id IN ({{LINE_LOCATION_ID}})
ORDER BY rt.transaction_date]');
        INSERT INTO wms_fusion_flow_steps (flow_id, step_no, step_key, step_name, module, parents, outputs, measure_col, hint, sql_text)
        VALUES (v_id, 4, 'S4', q'[Receipt accounting]', 'CST', 'S3', '', '',
                q'[Receipts not costed — run Transfer Transactions from Receiving to Costing and Create Receipt Accounting Distributions.]',
                q'[SELECT cre.accounting_event_id, cre.event_type_id, cre.transaction_date, cre.rcv_transaction_id
FROM   fusion.cmr_rcv_events cre
WHERE  cre.rcv_transaction_id IN ({{RCV_TRANSACTION_ID}})]');
        INSERT INTO wms_fusion_flow_steps (flow_id, step_no, step_key, step_name, module, parents, outputs, measure_col, hint, sql_text)
        VALUES (v_id, 5, 'S5', q'[Supplier invoice]', 'AP', 'S2', 'INVOICE_ID', 'LINE_AMOUNT',
                q'[No invoice matched to this PO.]',
                q'[SELECT ai.invoice_id, ai.invoice_num, ai.invoice_date, ai.invoice_amount, ai.payment_status_flag,
       ail.line_number, ail.line_type_lookup_code, ail.amount AS line_amount, ail.po_line_id
FROM   fusion.ap_invoice_lines_all ail
JOIN   fusion.ap_invoices_all ai ON ai.invoice_id = ail.invoice_id
WHERE  ail.po_header_id IN ({{PO_HEADER_ID}})
ORDER BY ai.invoice_num, ail.line_number]');
        INSERT INTO wms_fusion_flow_steps (flow_id, step_no, step_key, step_name, module, parents, outputs, measure_col, hint, sql_text)
        VALUES (v_id, 6, 'S6', q'[Payables accounting (SLA)]', 'XLA', 'S5', '', '',
                q'[Invoice not accounted — validate it and run Create Accounting.]',
                q'[SELECT xah.ae_header_id, xah.event_type_code, xah.accounting_date, xah.accounting_entry_status_code AS entry_status,
       xah.gl_transfer_status_code AS gl_transfer, xal.ae_line_num, xal.accounting_class_code,
       xal.accounted_dr, xal.accounted_cr
FROM   fusion.xla_transaction_entities xte
JOIN   fusion.xla_ae_headers xah ON xah.entity_id = xte.entity_id AND xah.application_id = xte.application_id
JOIN   fusion.xla_ae_lines xal ON xal.ae_header_id = xah.ae_header_id AND xal.application_id = xah.application_id
WHERE  xte.application_id = 200 AND xte.entity_code = 'AP_INVOICES'
AND    xte.source_id_int_1 IN ({{INVOICE_ID}})
ORDER BY xah.ae_header_id, xal.ae_line_num]');
        INSERT INTO wms_fusion_flow_steps (flow_id, step_no, step_key, step_name, module, parents, outputs, measure_col, hint, sql_text)
        VALUES (v_id, 7, 'S7', q'[Payments]', 'AP', 'S5', 'CHECK_ID', 'AMOUNT_PAID',
                q'[The invoice is not paid yet.]',
                q'[SELECT ac.check_id, ac.check_number, ac.check_date, ac.status_lookup_code, aip.invoice_id,
       aip.amount AS amount_paid, aip.accounting_date
FROM   fusion.ap_invoice_payments_all aip
JOIN   fusion.ap_checks_all ac ON ac.check_id = aip.check_id
WHERE  aip.invoice_id IN ({{INVOICE_ID}})]');
    END IF;
    COMMIT;
END;
/

SELECT f.flow_id, f.flow_name, f.source, (SELECT COUNT(*) FROM wms_fusion_flow_steps s WHERE s.flow_id = f.flow_id) AS steps
FROM wms_fusion_flows f ORDER BY f.flow_name;
