/* Order Management — starter setup. Used the first time (nothing saved in WMS_OM_SETTINGS yet) and by
   Setup › "Reset to starter". Everything here is editable in Setup and saved to APEX.
   Business units = the hard-coded list of the legacy order pad; sources = the BI Publisher reports the legacy
   screen called (same paths and parameter names), with Fusion SQL where no report existed. */

var OM_SEED_BUS = [
    { name: 'GRAYS INC BU', buId: '300000003234003', orgId: '300000003277749', warehouse: 'GRAYS INC', orgCode: 'GIC', subinventory: 'DUTY PAID', subinventories: 'DUTY PAID, NCONF', currency: 'MUR', active: 'Y' },
    { name: 'PHARMACY GRAYS INC BU', buId: '300000003234003', orgId: '300000003277749', warehouse: 'PHARMACY', orgCode: 'GPH', subinventory: 'STORES', subinventories: 'STORES', currency: 'MUR', active: 'Y' },
    { name: 'BEAU PLAN CELLARS', buId: '300000007956433', orgId: '300000003277749', warehouse: 'BEAU PLAN CELLARS', orgCode: 'BPC', subinventory: 'STORES', subinventories: 'STORES', currency: 'MUR', active: 'Y' },
    { name: 'GRAYS DISTILLING BU', buId: '300000007957224', orgId: '300000003277749', warehouse: 'GRAYS DISTILLING LTD', orgCode: 'GDL', subinventory: 'STORES', subinventories: 'STORES', currency: 'MUR', active: 'Y' },
    { name: 'BELLEVUE RUM', buId: '300000007957207', orgId: '300000003277749', warehouse: 'RDW GRAYS ROTTERDAM', orgCode: 'RDW', subinventory: 'STORES', subinventories: 'STORES', currency: 'MUR', active: 'Y' },
    { name: 'TERRA BRAND BU', buId: '300000037979006', orgId: '300000003277749', warehouse: 'TBC TERRA BRANDS', orgCode: 'TBC', subinventory: 'TBC', subinventories: 'TBC', currency: 'MUR', active: 'Y' },
    { name: 'TOPTERRA BU', buId: '300001214012161', buIdTest: '300001174920041', orgId: '300000003277749', warehouse: 'TTC TOPTERRA', orgCode: 'TTC', subinventory: 'TTCSUBIN', subinventories: 'TTCSUBIN', currency: 'MUR', active: 'Y' },
    { name: 'SUGARWORLD BU', buId: '300000004907002', orgId: '300000004914727', warehouse: '', orgCode: '', subinventory: '', subinventories: '', currency: 'MUR', active: 'Y' }
];

var OM_SEED_GENERAL = {
    precision: 2,
    taxRates: { 'GROT1.4': 15, 'GRTESTOUT17': 17, 'GROT1.2': 0, 'GROTCONS': 0 },
    maxDiscountPct: 50,
    returnReasonRequired: 'Y',
    dupPoBlocks: false,
    creditPaymentMethods: { credit: 'PS-CREDIT-01', cash: 'PS-CASH-01' },
    // Fusion salesOrdersForOrderHub
    sourceSystem: 'OPS',
    priceMode: 'FROZEN',              // FROZEN = send our list + selling price (legacy FREEZEPRICE) · MPA = Fusion list price + manual % adjustment · FUSION = Fusion prices it
    restVersion: '11.13.18.05',
    lineTypes: { ORD: { cat: 'ORDER', code: '' }, RET: { cat: 'RETURN', code: '' }, PADJ: { cat: 'ORDER', code: '' }, NADJ: { cat: 'RETURN', code: '' } },
    headerExtras: null,               // JSON merged into the order header, {{placeholders}} from the header (e.g. {"additionalInformation":[…]})
    lineExtras: null,
    defaultReturnReason: '',
    approvers: '',                    // app logins (comma separated) who may approve; empty = AI approvers are not used, anyone in Admins
    admins: '',                       // who may change Setup and Discounts; empty = everyone (first run)
    autoApplyDiscounts: true,
    mraOrderTypes: ''                 // order types that go to MRA after booking (empty = ask the MRA endpoint as the WMS does)
};

/* A source: kind BIP (BI Publisher report path + parameters), SQL (Fusion SQL runner, read-only) or APEX (APEX SQL).
   {{NAME}} in parameters / SQL is filled from the page (BU_ID, BU_NAME, ORG_ID, PRICE_LIST, PRICING_DATE, Q …).
   map = { canonicalField: 'SOURCE_COLUMN' } when a report uses other column names (Setup › Sources › Test shows them). */
var OM_SEED_SOURCES = {
    customers: { label: 'Customer search', kind: 'BIP', path: '/Custom/DEXPRESS/Receivables/CUSTOMER_SEARCH_BY_NAME_BIP.xdo',
        params: { CUSTOMER_NAME: '{{Q_NAME}}', BUSINESS_UNIT_ID: '{{BU_ID}}', CUSTOMER_CLASS: '', CUSTOMER_CATEGORY: '', CUSTOMER_NUMBER: '{{Q_NUMBER}}' },
        fields: 'CUSTOMER_NUMBER, CUSTOMER_NAME, CUST_ACCOUNT_ID, PARTY_ID, SITE_USE_ID, PARTY_SITE_ID, CREDIT_LIMIT, PAYMENT_TERMS, CUSTOMER_CLASS, CUSTOMER_CATEGORY, PRICE_LIST, VAT, BRN, CONSIGNMENT, ADDRESS' },
    priceLists: { label: 'Price lists', kind: 'SQL',
        sql: "SELECT t.name AS price_list_name, b.price_list_id, b.currency_code, TO_CHAR(b.start_date, 'YYYY-MM-DD') AS start_date\nFROM qp_price_lists_all_b b\nJOIN qp_price_lists_tl t ON t.price_list_id = b.price_list_id AND t.language = USERENV('LANG')\nWHERE NVL(b.end_date, SYSDATE + 1) > SYSDATE\nORDER BY t.name",
        fields: 'PRICE_LIST_NAME, PRICE_LIST_ID, CURRENCY_CODE' },
    priceItems: { label: 'Price list items', kind: 'BIP', path: '/Custom/DEXPRESS/ORDER MANAGEMENT/FUSION_PRICE_LIST_BY_PRICING_DATE_BIP_V1.xdo',
        params: { PRICE_LIST_NAME: '{{PRICE_LIST}}', ORG_ID: '{{BU_ID}}', ITEM_DESC: '', PRICING_DATE: '{{PRICING_DATE}}' },
        fields: 'ITEM_NUMBER, ITEM_DESC, UOM_CODE, LIST_PRICE, CURRENCY_CODE, TAX_CODE, CONS, CONSIGNMENTITEM, CRT_ITEM_CODE, CRT, CRT_MIN_QTY, CRT_DEFAULT_QTY, PROFIT_CENTER, SUPPLIER, BRAND, CATEGORY, SUB_CATEGORY, GROUPCODE, BARCODE, ITEM_TYPE, LOT_NUMBER, BUFFERSTOCK' },
    orderTypes: { label: 'Order types', kind: 'BIP', path: '/Custom/DEXPRESS/ORDER MANAGEMENT/POS_RERPOTS/ORDER_TYPES_BIP.xdo',
        params: { BUSINESS_UNIT_ID: '{{BU_ID}}' },
        fields: 'ORDER_TYPE_CODE, ORDER_TYPE (name), TAX, DISCOUNTS, CREDITCHECK, LINETYPE, CHECKVIPSTOCK, BACKORDERSTATUS, STOCKSTATUS' },
    warehouses: { label: 'Warehouses', kind: 'BIP', path: '/Custom/DEXPRESS/ORDER MANAGEMENT/POS_RERPOTS/ORGANIZATION_MASTERS_BIP.xdo',
        params: { BUSINESS_UNIT_ID: '{{BU_ID}}' }, fields: 'ORGANIZATION_CODE, ORGANIZATION_NAME, ORGANIZATION_ID' },
    salesreps: { label: 'Sales reps', kind: 'BIP', path: '/Custom/DEXPRESS/ORDER MANAGEMENT/SALESPERSON_BIP.xdo', params: {},
        fields: 'SALESREP_NAME, SALESREP_ID, SALESREP_NUMBER' },
    officers: { label: 'Delivery officers', kind: 'BIP', path: '/Custom/DEXPRESS/ORDER MANAGEMENT/POS_RERPOTS/DOO_OFFICER_BIP.xdo', params: {},
        fields: 'NAME, NUMBER' },
    returnReasons: { label: 'Return reasons', kind: 'BIP', path: '/Custom/DEXPRESS/ORDER MANAGEMENT/POS_RERPOTS/RETURN_REASON_BIP.xdo',
        params: { BUSINESS_UNIT_ID: '{{BU_ID}}' }, fields: 'LOOKUP_CODE, MEANING' },
    credit: { label: 'Credit check', kind: 'BIP', path: '/Custom/OQ/OM/CREDIT_CHECK/GR_CREDIT_CHECK_BIP.xdo',
        params: { BU_NAME: '{{BU_NAME}}', p_cust_no: '{{CUSTOMER_NUMBER}}', p_so_amt: '{{AMOUNT}}' },
        fields: 'CREDIT_LIMIT, BALANCE (open receivables), ON_HOLD (Y/N), HOLD_NOTE' },
    period: { label: 'OM period status', kind: 'BIP', path: '/Custom/DEXPRESS/REPORTING_SETUP/OM_PERIOD_STATUS_BIP.xdo',
        params: { PERIOD: '{{PERIOD}}' }, fields: 'STATUS / CLOSING_STATUS (O = open)' },
    stock: { label: 'On-hand stock', kind: 'SQL',
        sql: "SELECT i.item_number, SUM(d.primary_transaction_quantity) AS qty\nFROM inv_onhand_quantities_detail d\nJOIN egp_system_items_b i ON i.inventory_item_id = d.inventory_item_id AND i.organization_id = d.organization_id\nWHERE d.organization_id = {{ORG_ID}}\n  AND ('{{SUBINVENTORY}}' IS NULL OR d.subinventory_code = '{{SUBINVENTORY}}')\n  AND i.item_number IN ({{ITEMS}})\nGROUP BY i.item_number",
        fields: 'ITEM_NUMBER, QTY' },
    dupPo: { label: 'Customer PO already used', kind: 'SQL',
        sql: "SELECT h.order_number\nFROM doo_headers_all h\nWHERE h.customer_po_number = '{{PO}}'\n  AND h.submitted_flag = 'Y'\n  AND NVL(h.status_code, 'X') <> 'CANCELED'\nFETCH FIRST 5 ROWS ONLY",
        fields: 'ORDER_NUMBER' },
    adjRef: { label: 'Reference order exists', kind: 'SQL',
        sql: "SELECT h.order_number FROM doo_headers_all h WHERE h.order_number = '{{REF}}' FETCH FIRST 1 ROWS ONLY", fields: 'ORDER_NUMBER' },
    orderStatus: { label: 'Order status in Fusion', kind: 'SQL',
        sql: "SELECT h.header_id, h.order_number, h.source_order_number, h.status_code, h.submitted_flag,\n       (SELECT COUNT(*) FROM doo_fulfill_lines_all f WHERE f.header_id = h.header_id) AS line_count,\n       (SELECT COUNT(*) FROM doo_fulfill_lines_all f WHERE f.header_id = h.header_id AND f.status_code IN ('SHIPPED','BILLED','CLOSED','PARTIALLY_SHIPPED')) AS shipped_lines\nFROM doo_headers_all h\nWHERE h.source_order_number IN ({{ORDER_NOS}})\n  AND h.change_version_number = (SELECT MAX(x.change_version_number) FROM doo_headers_all x WHERE x.source_order_number = h.source_order_number)",
        fields: 'HEADER_ID, ORDER_NUMBER, SOURCE_ORDER_NUMBER, STATUS_CODE, SHIPPED_LINES' },
    orderLines: { label: 'Order lines from Fusion (copy / credit note)', kind: 'SQL',
        sql: "SELECT h.order_number, h.source_order_number, h.customer_po_number, f.fulfill_line_number AS line_no, i.item_number, i.description AS item_desc,\n       f.ordered_qty AS qty, f.ordered_uom AS uom, f.unit_list_price AS list_price, f.unit_selling_price AS selling_price, f.status_code, f.category_code\nFROM doo_headers_all h\nJOIN doo_fulfill_lines_all f ON f.header_id = h.header_id\nJOIN egp_system_items_b i ON i.inventory_item_id = f.inventory_item_id AND i.organization_id = f.inventory_organization_id\nWHERE (h.order_number = '{{ORDER_NO}}' OR h.source_order_number = '{{ORDER_NO}}')\n  AND h.change_version_number = (SELECT MAX(x.change_version_number) FROM doo_headers_all x WHERE x.header_id = h.header_id OR x.order_number = h.order_number)\nORDER BY f.fulfill_line_number",
        fields: 'ITEM_NUMBER, QTY, LIST_PRICE, SELLING_PRICE, LOT_NUMBER' },
    discounts: { label: 'Discount rules from Fusion (sync)', kind: 'BIP', path: '/Custom/DEXPRESS/ORDER MANAGEMENT/POS_RERPOTS/FUSION_DISCOUNTS_BIP.xdo',
        params: { CUSTOMER_CAT: '', PRICE_LIST_NAME: '', CUSTOMER_NUMBER: '' },
        fields: 'CUSTOMER_NUMBER, CUSTOMER_CAT, ITEM_CODE, DISCOUNT_PER, QUALIFIER_CONTEXT, START_DATE_ACTIVE, END_DATE_ACTIVE, EXCLUDER_FLAG, EBS_DISCOUNT_REF, FROM_QTY, TO_QTY' },
    mraCheck: { label: 'MRA already done', kind: 'BIP', path: '/Custom/DEXPRESS/ORDER MANAGEMENT/POS_RERPOTS/MRA_TRX_NO_CHECK_BIP.xdo',
        params: { source_order_number: '{{ORDER_NO}}', ORGANIZATION_NAME: '{{WAREHOUSE}}' }, fields: 'any row = already sent' }
};

var OM_SEED_LAYOUTS = [
    { name: 'Sales order', path: '/Custom/OQ/GR_SalesOrder_Rep.xdo', param: 'Order_Number', extra: '', bus: '' },
    { name: 'Sales order (logo, web)', path: '/Custom/DHA/OM/GR_SALES_ORDER_WEB/GR_SalesOrder_Web_Logo_Rep.xdo', param: 'Order_Number', extra: '', bus: '' },
    { name: 'Preview (view only)', path: '/Custom/OQ/GR_SALESORDER_ONLY_FOR_VIEW_BIP.xdo', param: 'Order_Number', extra: '', bus: '' },
    { name: 'Proforma', path: '/Custom/OQ/GR_SalesOrder_Export_Rep_4_fusion.xdo', param: 'Order_Number', extra: 'P_EXP=P', bus: '' },
    { name: 'Export', path: '/Custom/OQ/GR_SalesOrder_Export_Rep_4_fusion.xdo', param: 'Order_Number', extra: 'P_EXP=E', bus: '' },
    { name: 'Duty free', path: '/Custom/OQ/GR_SalesOrder_Export_Rep_4_fusion.xdo', param: 'Order_Number', extra: 'P_EXP=D', bus: '' },
    { name: 'Proforma (web)', path: '/Custom/DHA/OM/GR_SALES_ORDER_WEB/GR_SalesOrder_Proforma_Web_Rep.xdo', param: 'Order_Number', extra: 'P_EXP=P', bus: '' },
    { name: 'Terra Brands order', path: '/Custom/DHA/OM/TERRA BRANDS/TB_SALES_ORDER.xdo', param: 'Order_Number', extra: 'P_EXP=P', bus: 'TERRA BRAND BU' },
    { name: 'Terra Brands proforma', path: '/Custom/DHA/OM/TERRA BRANDS/TB_SALES_ORDER_PROFORMA.xdo', param: 'Order_Number', extra: 'P_EXP=P', bus: 'TERRA BRAND BU' },
    { name: 'Topterra invoice', path: '/Custom/DHA/OM/TOPTERRA/TOT_SALES_ORDER/TOT_SALES_ORDER_INVOICE.xdo', param: 'Order_Number', extra: 'P_EXP=P', bus: 'TOPTERRA BU' },
    { name: 'Topterra proforma', path: '/Custom/DHA/OM/TOPTERRA/TOT_SALES_ORDER/TOT_SALES_ORDER_PROFORMA.xdo', param: 'Order_Number', extra: 'P_EXP=P', bus: 'TOPTERRA BU' },
    { name: 'Topterra delivery note', path: '/Custom/DHA/OM/TOPTERRA/TOT_SALES_ORDER/TOT_SALES_ORDER_DELIVERY_NOTE.xdo', param: 'Order_Number', extra: 'P_EXP=P', bus: 'TOPTERRA BU' }
];
