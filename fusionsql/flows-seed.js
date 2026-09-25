/* ═══════════════════════════════════════════════════════════════
   Fusion SQL — starter process flows (Flows tab › Load starter flows)
   A flow is an ordered set of read-only SQL steps that follow ONE
   business document through Fusion. Steps hand keys to later steps:
     outputs: ['HEADER_ID']     → later SQL uses  IN ({{HEADER_ID}})
     {{KEY:str}}                → the values as quoted strings
     {{P_...}}                  → a flow parameter the user types
   These are starters: joins follow the standard Fusion data model,
   but pods differ — use "Ask AI to fix this step" on any red step.
   ═══════════════════════════════════════════════════════════════ */

window.FS_FLOW_SEED = [
    {
        name: 'Order to Cash (OTC)',
        description: 'Follows one sales order: order → fulfillment lines → shipment → inventory issue → cost/COGS → AR invoice → revenue distributions → subledger accounting → customer receipts. Shows where the order stopped and the margin.',
        params: [{ name: 'P_ORDER_NUMBER', label: 'Sales order number', sample: '' }],
        steps: [
            {
                key: 'S1', name: 'Sales order', module: 'OM', parents: [], outputs: ['HEADER_ID'],
                hint: 'No submitted order with this number — check the order number (source order numbers are not the Fusion order number).',
                sql: "SELECT h.header_id, h.order_number, h.source_order_number, h.status_code, h.ordered_date,\n" +
                    "       h.transactional_currency_code AS currency, p.party_name AS customer, h.org_id AS bu_id\n" +
                    "FROM   fusion.doo_headers_all h\n" +
                    "LEFT JOIN fusion.hz_parties p ON p.party_id = h.sold_to_party_id\n" +
                    "WHERE  h.order_number = TO_CHAR({{P_ORDER_NUMBER}})\n" +
                    "AND    h.submitted_flag = 'Y'"
            },
            {
                key: 'S2', name: 'Fulfillment lines', module: 'OM', parents: ['S1'], outputs: ['FULFILL_LINE_ID'], measure: 'EXTENDED_AMOUNT',
                hint: 'The order has no fulfillment lines — it may not be submitted to fulfillment yet.',
                sql: "SELECT fl.fulfill_line_id, fl.fulfill_line_number, fl.status_code, fl.inventory_item_id,\n" +
                    "       i.item_number, fl.ordered_qty, fl.shipped_qty, fl.unit_selling_price, fl.extended_amount,\n" +
                    "       fl.fulfill_org_id, fl.request_ship_date, fl.actual_ship_date\n" +
                    "FROM   fusion.doo_fulfill_lines_all fl\n" +
                    "LEFT JOIN fusion.egp_system_items_b i ON i.inventory_item_id = fl.inventory_item_id AND i.organization_id = fl.fulfill_org_id\n" +
                    "WHERE  fl.header_id IN ({{HEADER_ID}})\n" +
                    "ORDER BY fl.fulfill_line_number"
            },
            {
                key: 'S3', name: 'Shipment', module: 'WSH', parents: ['S2'], outputs: ['DELIVERY_DETAIL_ID', 'DELIVERY_ID'],
                hint: 'Not interfaced to shipping yet — check the fulfillment line status / orchestration process.',
                sql: "SELECT wdd.delivery_detail_id, wdd.released_status, wdd.requested_quantity, wdd.shipped_quantity,\n" +
                    "       wda.delivery_id, wnd.name AS delivery_name, wnd.status_code AS delivery_status,\n" +
                    "       wnd.initial_pickup_date AS ship_date, wdd.organization_id\n" +
                    "FROM   fusion.wsh_delivery_details wdd\n" +
                    "LEFT JOIN fusion.wsh_delivery_assignments wda ON wda.delivery_detail_id = wdd.delivery_detail_id\n" +
                    "LEFT JOIN fusion.wsh_new_deliveries wnd ON wnd.delivery_id = wda.delivery_id\n" +
                    "WHERE  wdd.source_shipment_id IN ({{FULFILL_LINE_ID}})"
            },
            {
                key: 'S4', name: 'Inventory issue', module: 'INV', parents: ['S3'], outputs: ['TRANSACTION_ID'],
                hint: 'Shipped lines but no inventory transaction — ship confirm may not be complete, or the transaction is still in the interface.',
                sql: "SELECT mt.transaction_id, mt.transaction_date, mt.transaction_type_id, mt.inventory_item_id,\n" +
                    "       mt.organization_id, mt.subinventory_code, mt.transaction_quantity, mt.transaction_uom\n" +
                    "FROM   fusion.inv_material_txns mt\n" +
                    "WHERE  mt.trx_source_line_id IN ({{FULFILL_LINE_ID}})\n" +
                    "ORDER BY mt.transaction_date"
            },
            {
                key: 'S5', name: 'Cost / COGS', module: 'CST', parents: ['S4'], outputs: ['COST_TRANSACTION_ID'], measure: 'COGS_AMOUNT',
                hint: 'Inventory moved but not costed — run Transfer Transactions from Inventory to Costing, then Create Cost Accounting Distributions.',
                sql: "SELECT ct.transaction_id AS cost_transaction_id, cit.cst_inv_transaction_id, cit.external_system_ref_id AS inv_transaction_id,\n" +
                    "       ccd.distribution_id, ccdl.line_type, ccdl.accounted_amount,\n" +
                    "       CASE WHEN UPPER(ccdl.line_type) LIKE '%COGS%' THEN ccdl.accounted_amount END AS cogs_amount\n" +
                    "FROM   fusion.cst_inv_transactions cit\n" +
                    "JOIN   fusion.cst_transactions ct ON ct.cst_inv_transaction_id = cit.cst_inv_transaction_id\n" +
                    "LEFT JOIN fusion.cst_cost_distributions ccd ON ccd.transaction_id = ct.transaction_id\n" +
                    "LEFT JOIN fusion.cst_cost_distribution_lines ccdl ON ccdl.distribution_id = ccd.distribution_id\n" +
                    "WHERE  cit.external_system_ref_id IN ({{TRANSACTION_ID:str}})"
            },
            {
                key: 'S6', name: 'AR invoice', module: 'AR', parents: ['S2'], outputs: ['CUSTOMER_TRX_ID'], measure: 'EXTENDED_AMOUNT',
                hint: 'No receivables invoice — run Import AutoInvoice (and check the AR interface for errors).',
                sql: "SELECT rct.customer_trx_id, rct.trx_number, rct.trx_date, rct.complete_flag, rctl.line_number,\n" +
                    "       rctl.line_type, rctl.description, rctl.quantity_invoiced, rctl.unit_selling_price, rctl.extended_amount\n" +
                    "FROM   fusion.ra_customer_trx_lines_all rctl\n" +
                    "JOIN   fusion.ra_customer_trx_all rct ON rct.customer_trx_id = rctl.customer_trx_id\n" +
                    "WHERE  rctl.sales_order = TO_CHAR({{P_ORDER_NUMBER}})\n" +
                    "ORDER BY rct.trx_number, rctl.line_number"
            },
            {
                key: 'S7', name: 'Revenue distributions', module: 'AR', parents: ['S6'], outputs: [], measure: 'REVENUE_AMOUNT',
                hint: 'The invoice has no distributions — it may be incomplete.',
                sql: "SELECT gld.cust_trx_line_gl_dist_id, gld.account_class, gld.gl_date, gld.amount, gld.acctd_amount,\n" +
                    "       CASE WHEN gld.account_class = 'REV' THEN gld.acctd_amount END AS revenue_amount,\n" +
                    "       gld.code_combination_id, gld.posting_control_id\n" +
                    "FROM   fusion.ra_cust_trx_line_gl_dist_all gld\n" +
                    "WHERE  gld.customer_trx_id IN ({{CUSTOMER_TRX_ID}})\n" +
                    "ORDER BY gld.account_class"
            },
            {
                key: 'S8', name: 'AR accounting (SLA)', module: 'XLA', parents: ['S7'], outputs: ['AE_HEADER_ID'],
                hint: 'Not accounted yet — run Create Receivables Accounting.',
                sql: "SELECT xah.ae_header_id, xah.event_type_code, xah.accounting_date, xah.accounting_entry_status_code AS entry_status,\n" +
                    "       xah.gl_transfer_status_code AS gl_transfer, xal.ae_line_num, xal.accounting_class_code,\n" +
                    "       xal.accounted_dr, xal.accounted_cr, xal.code_combination_id\n" +
                    "FROM   fusion.xla_transaction_entities xte\n" +
                    "JOIN   fusion.xla_ae_headers xah ON xah.entity_id = xte.entity_id AND xah.application_id = xte.application_id\n" +
                    "JOIN   fusion.xla_ae_lines xal ON xal.ae_header_id = xah.ae_header_id AND xal.application_id = xah.application_id\n" +
                    "WHERE  xte.application_id = 222 AND xte.entity_code = 'TRANSACTIONS'\n" +
                    "AND    xte.source_id_int_1 IN ({{CUSTOMER_TRX_ID}})\n" +
                    "ORDER BY xah.ae_header_id, xal.ae_line_num"
            },
            {
                key: 'S9', name: 'Customer receipts', module: 'AR', parents: ['S6'], outputs: ['CASH_RECEIPT_ID'], measure: 'AMOUNT_APPLIED',
                hint: 'The invoice is not paid yet (no applied receipt).',
                sql: "SELECT ara.cash_receipt_id, acr.receipt_number, acr.receipt_date, ara.apply_date, ara.gl_date,\n" +
                    "       ara.status, ara.amount_applied\n" +
                    "FROM   fusion.ar_receivable_applications_all ara\n" +
                    "JOIN   fusion.ar_cash_receipts_all acr ON acr.cash_receipt_id = ara.cash_receipt_id\n" +
                    "WHERE  ara.applied_customer_trx_id IN ({{CUSTOMER_TRX_ID}})\n" +
                    "AND    ara.status = 'APP'"
            }
        ],
        summary: [
            { label: 'Ordered', step: 'S2', column: 'EXTENDED_AMOUNT' },
            { label: 'Invoiced', step: 'S6', column: 'EXTENDED_AMOUNT' },
            { label: 'Revenue', step: 'S7', column: 'REVENUE_AMOUNT' },
            { label: 'COGS', step: 'S5', column: 'COGS_AMOUNT' },
            { label: 'Margin', expr: 'Revenue - COGS' },
            { label: 'Margin %', expr: '(Revenue - COGS) / Revenue * 100', fmt: 'pct' },
            { label: 'Received', step: 'S9', column: 'AMOUNT_APPLIED' }
        ]
    },
    {
        name: 'Procure to Pay (P2P)',
        description: 'Follows one purchase order: PO → lines/schedules → receipts → receipt accounting → supplier invoice → payables accounting → payments.',
        params: [{ name: 'P_PO_NUMBER', label: 'Purchase order number', sample: '' }],
        steps: [
            {
                key: 'S1', name: 'Purchase order', module: 'PO', parents: [], outputs: ['PO_HEADER_ID'],
                hint: 'No PO with this number.',
                sql: "SELECT ph.po_header_id, ph.segment1 AS po_number, ph.document_status, ph.type_lookup_code,\n" +
                    "       ph.currency_code, hp.party_name AS supplier, ph.creation_date, ph.prc_bu_id\n" +
                    "FROM   fusion.po_headers_all ph\n" +
                    "LEFT JOIN fusion.poz_suppliers s ON s.vendor_id = ph.vendor_id\n" +
                    "LEFT JOIN fusion.hz_parties hp ON hp.party_id = s.party_id\n" +
                    "WHERE  ph.segment1 = TO_CHAR({{P_PO_NUMBER}})"
            },
            {
                key: 'S2', name: 'Lines & schedules', module: 'PO', parents: ['S1'], outputs: ['PO_LINE_ID', 'LINE_LOCATION_ID'], measure: 'LINE_AMOUNT',
                hint: 'The PO has no lines.',
                sql: "SELECT pl.po_line_id, pl.line_num, pl.item_id, pl.item_description, pl.quantity, pl.unit_price,\n" +
                    "       pl.quantity * pl.unit_price AS line_amount, pll.line_location_id, pll.quantity_received,\n" +
                    "       pll.quantity_billed, pll.need_by_date\n" +
                    "FROM   fusion.po_lines_all pl\n" +
                    "LEFT JOIN fusion.po_line_locations_all pll ON pll.po_line_id = pl.po_line_id\n" +
                    "WHERE  pl.po_header_id IN ({{PO_HEADER_ID}})\n" +
                    "ORDER BY pl.line_num"
            },
            {
                key: 'S3', name: 'Receipts', module: 'RCV', parents: ['S2'], outputs: ['RCV_TRANSACTION_ID'],
                hint: 'Nothing received against this PO yet.',
                sql: "SELECT rt.transaction_id AS rcv_transaction_id, rsh.receipt_num, rt.transaction_type, rt.transaction_date,\n" +
                    "       rt.quantity, rt.po_unit_price, rt.destination_type_code\n" +
                    "FROM   fusion.rcv_transactions rt\n" +
                    "LEFT JOIN fusion.rcv_shipment_headers rsh ON rsh.shipment_header_id = rt.shipment_header_id\n" +
                    "WHERE  rt.po_line_location_id IN ({{LINE_LOCATION_ID}})\n" +
                    "ORDER BY rt.transaction_date"
            },
            {
                key: 'S4', name: 'Receipt accounting', module: 'CST', parents: ['S3'], outputs: [],
                hint: 'Receipts not costed — run Transfer Transactions from Receiving to Costing and Create Receipt Accounting Distributions.',
                sql: "SELECT cre.accounting_event_id, cre.event_type_id, cre.transaction_date, cre.rcv_transaction_id\n" +
                    "FROM   fusion.cmr_rcv_events cre\n" +
                    "WHERE  cre.rcv_transaction_id IN ({{RCV_TRANSACTION_ID}})"
            },
            {
                key: 'S5', name: 'Supplier invoice', module: 'AP', parents: ['S2'], outputs: ['INVOICE_ID'], measure: 'LINE_AMOUNT',
                hint: 'No invoice matched to this PO.',
                sql: "SELECT ai.invoice_id, ai.invoice_num, ai.invoice_date, ai.invoice_amount, ai.payment_status_flag,\n" +
                    "       ail.line_number, ail.line_type_lookup_code, ail.amount AS line_amount, ail.po_line_id\n" +
                    "FROM   fusion.ap_invoice_lines_all ail\n" +
                    "JOIN   fusion.ap_invoices_all ai ON ai.invoice_id = ail.invoice_id\n" +
                    "WHERE  ail.po_header_id IN ({{PO_HEADER_ID}})\n" +
                    "ORDER BY ai.invoice_num, ail.line_number"
            },
            {
                key: 'S6', name: 'Payables accounting (SLA)', module: 'XLA', parents: ['S5'], outputs: [],
                hint: 'Invoice not accounted — validate it and run Create Accounting.',
                sql: "SELECT xah.ae_header_id, xah.event_type_code, xah.accounting_date, xah.accounting_entry_status_code AS entry_status,\n" +
                    "       xah.gl_transfer_status_code AS gl_transfer, xal.ae_line_num, xal.accounting_class_code,\n" +
                    "       xal.accounted_dr, xal.accounted_cr\n" +
                    "FROM   fusion.xla_transaction_entities xte\n" +
                    "JOIN   fusion.xla_ae_headers xah ON xah.entity_id = xte.entity_id AND xah.application_id = xte.application_id\n" +
                    "JOIN   fusion.xla_ae_lines xal ON xal.ae_header_id = xah.ae_header_id AND xal.application_id = xah.application_id\n" +
                    "WHERE  xte.application_id = 200 AND xte.entity_code = 'AP_INVOICES'\n" +
                    "AND    xte.source_id_int_1 IN ({{INVOICE_ID}})\n" +
                    "ORDER BY xah.ae_header_id, xal.ae_line_num"
            },
            {
                key: 'S7', name: 'Payments', module: 'AP', parents: ['S5'], outputs: ['CHECK_ID'], measure: 'AMOUNT_PAID',
                hint: 'The invoice is not paid yet.',
                sql: "SELECT ac.check_id, ac.check_number, ac.check_date, ac.status_lookup_code, aip.invoice_id,\n" +
                    "       aip.amount AS amount_paid, aip.accounting_date\n" +
                    "FROM   fusion.ap_invoice_payments_all aip\n" +
                    "JOIN   fusion.ap_checks_all ac ON ac.check_id = aip.check_id\n" +
                    "WHERE  aip.invoice_id IN ({{INVOICE_ID}})"
            }
        ],
        summary: [
            { label: 'PO amount', step: 'S2', column: 'LINE_AMOUNT' },
            { label: 'Invoiced', step: 'S5', column: 'LINE_AMOUNT' },
            { label: 'Paid', step: 'S7', column: 'AMOUNT_PAID' },
            { label: 'Open to pay', expr: 'Invoiced - Paid' }
        ]
    }
];
