/* Oracle Fusion REST APIs for loading data — curated by module and category.
   r = resource (…/{api}RestApi/resources/11.13.18.05/{r}), api = fscm | hcm | crm, a = area (FBDI_AREAS codes + HCM / CRM / COM),
   k = SETUP | MASTER | TXN | UTIL, ops = G get · P post (create) · U patch (update), ch = child collections to send in the same payload,
   key = the attribute a PATCH addresses, f = the FBDI template that loads the same data in bulk, d = what it is for.
   Resource names follow Oracle's REST reference; "Check on pod" confirms each one on your own pod, and any other
   resource can be opened by name — its /describe tells the app every field. */
window.FAPI_KINDS = [
    ['SETUP', 'Setup', 'Configuration that other data points to — ledgers, value sets, organizations, units of measure, jobs', 'fa-sliders'],
    ['MASTER', 'Masters', 'Business entities you create once and reuse — suppliers, items, customers, banks, projects, workers', 'fa-id-card'],
    ['TXN', 'Transactions', 'Day-to-day documents — invoices, orders, receipts, inventory moves, costs', 'fa-arrow-right-arrow-left'],
    ['UTIL', 'Integration', 'Services that move files and jobs — FBDI import/export, FSM setup exports', 'fa-plug']
];
window.FAPI_AREAS_EXTRA = [['HCM', 'HCM', '#0369a1'], ['CRM', 'Sales & Service', '#be123c'], ['COM', 'Common', '#334155']];
window.FAPI_CATALOG = [
    // ── General Ledger
    { r: 'ledgersLOV', a: 'GL', k: 'SETUP', ops: 'G', n: 'Ledgers', d: 'Ledgers with chart of accounts, calendar and currency — look up LedgerId / names for journals.' },
    { r: 'valueSets', a: 'GL', k: 'SETUP', ops: 'GPU', ch: ['values'], key: 'ValueSetId', n: 'Value Sets & Values', d: 'Chart of accounts segment values (and any independent value set). Create values one by one.', f: 'ChartOfAccountsSegmentValuesAndHierarchiesImportTemplate' },
    { r: 'accountCombinationsLOV', a: 'GL', k: 'MASTER', ops: 'G', n: 'Account Combinations', d: 'Look up existing code combinations (CCIDs). New combinations in bulk go through FBDI.', f: 'AccountCombinationsImportTemplate' },
    { r: 'currencyRates', a: 'GL', k: 'MASTER', ops: 'GP', n: 'Daily Currency Rates', d: 'Daily conversion rates between currency pairs.', f: 'DailyRatesImportTemplate' },
    { r: 'generalLedgerBalances', a: 'GL', k: 'TXN', ops: 'G', n: 'GL Balances', d: 'Read period balances by ledger, account and period — reconcile after a load.' },
    // ── Payables
    { r: 'invoices', a: 'AP', k: 'TXN', ops: 'GPU', ch: ['invoiceLines', 'invoiceInstallments', 'attachments'], key: 'InvoiceId', n: 'Payables Invoices', d: 'Create standard invoices with lines (and distributions under the lines); validate, hold, cancel through actions.', f: 'PayablesStandardInvoiceImportTemplate' },
    { r: 'invoiceHolds', a: 'AP', k: 'TXN', ops: 'GPU', key: 'HoldId', n: 'Invoice Holds', d: 'Place or release holds on invoices.' },
    { r: 'payablesPayments', a: 'AP', k: 'TXN', ops: 'G', n: 'Payables Payments', d: 'Payments made to suppliers — status, amounts, invoices paid.' },
    { r: 'expenseReports', a: 'AP', k: 'TXN', ops: 'GPU', ch: ['Expense'], key: 'ExpenseReportId', n: 'Expense Reports', d: 'Employee expense reports with expense items.' },
    { r: 'expenses', a: 'AP', k: 'TXN', ops: 'GPU', key: 'ExpenseId', n: 'Expense Items', d: 'Individual expense items (card transactions, cash expenses).' },
    // ── Receivables
    { r: 'receivablesInvoices', a: 'AR', k: 'TXN', ops: 'GPU', ch: ['receivablesInvoiceLines'], key: 'CustomerTransactionId', n: 'Receivables Invoices', d: 'Create customer invoices with lines — immediate transaction number back.', f: 'AutoInvoiceImportTemplate' },
    { r: 'receivablesCreditMemos', a: 'AR', k: 'TXN', ops: 'GP', ch: ['receivablesCreditMemoLines'], key: 'CustomerTransactionId', n: 'Credit Memos', d: 'Customer credit memos with lines.' },
    { r: 'standardReceipts', a: 'AR', k: 'TXN', ops: 'GP', key: 'StandardReceiptId', n: 'Standard Receipts', d: 'Customer receipts — create and apply to invoices.' },
    { r: 'receivablesCustomerAccountActivities', a: 'AR', k: 'TXN', ops: 'G', n: 'Customer Account Activity', d: 'Open transactions and receipts per customer account.' },
    // ── Cash Management
    { r: 'cashBanks', a: 'CE', k: 'MASTER', ops: 'GPU', key: 'BankPartyId', n: 'Banks', d: 'Banks (the bank party) — create before branches and accounts.' },
    { r: 'cashBankBranches', a: 'CE', k: 'MASTER', ops: 'GPU', key: 'BranchPartyId', n: 'Bank Branches', d: 'Branches of a bank, with routing / SWIFT codes.' },
    { r: 'cashBankAccounts', a: 'CE', k: 'MASTER', ops: 'GPU', ch: ['bankAccountUses'], key: 'BankAccountId', n: 'Bank Accounts', d: 'Internal bank accounts with their business-unit uses and GL accounts.' },
    { r: 'cashExternalTransactions', a: 'CE', k: 'TXN', ops: 'GPU', key: 'ExternalTransactionId', n: 'External Cash Transactions', d: 'Bank charges, interest and other cash movements to reconcile.', f: 'CashManagementBankStatementImportTemplate' },
    // ── Suppliers
    { r: 'suppliers', a: 'SUP', k: 'MASTER', ops: 'GPU', ch: ['addresses', 'sites', 'contacts', 'productsAndServices', 'businessClassifications'], key: 'SupplierId', n: 'Suppliers', d: 'Supplier profile with addresses, sites, contacts and classifications in one call.', f: 'SupplierImportTemplate' },
    // ── Purchasing
    { r: 'draftPurchaseOrders', a: 'PO', k: 'TXN', ops: 'GPU', ch: ['lines'], key: 'POHeaderId', n: 'Purchase Orders (draft → submit)', d: 'Create purchase orders with lines, schedules and distributions, then submit them with the submit action.', f: 'POPurchaseOrderImportTemplate' },
    { r: 'purchaseOrders', a: 'PO', k: 'TXN', ops: 'G', key: 'POHeaderId', n: 'Purchase Orders', d: 'Approved purchase orders — read, or close / cancel through actions.' },
    { r: 'purchaseRequisitions', a: 'PO', k: 'TXN', ops: 'GPU', ch: ['lines'], key: 'RequisitionHeaderId', n: 'Requisitions', d: 'Purchase requisitions with lines and distributions.', f: 'RequisitionImportTemplate' },
    { r: 'receivingReceiptRequests', a: 'PO', k: 'TXN', ops: 'GP', ch: ['lines'], key: 'HeaderInterfaceId', n: 'Receipts (Receiving)', d: 'Receive against purchase orders, ASNs and transfer orders — processed straight away.', f: 'ReceivingReceiptImportTemplate' },
    { r: 'procurementAgents', a: 'PO', k: 'SETUP', ops: 'GPU', key: 'AssignmentId', n: 'Procurement Agents', d: 'Buyers and their access per procurement business unit.' },
    // ── Inventory & items
    { r: 'itemsV2', a: 'INV', k: 'MASTER', ops: 'GPU', key: 'ItemId', n: 'Items', d: 'Items per organization with their attributes, categories and revisions.', f: 'ItemImportTemplate' },
    { r: 'itemStructures', a: 'INV', k: 'MASTER', ops: 'GP', key: 'BillSequenceId', n: 'Item Structures (BOMs)', d: 'Bills of material with components.', f: 'ItemStructureImportTemplate' },
    { r: 'inventoryOrganizations', a: 'INV', k: 'SETUP', ops: 'G', n: 'Inventory Organizations', d: 'Warehouses / inventory orgs with their parameters.' },
    { r: 'unitsOfMeasure', a: 'INV', k: 'SETUP', ops: 'G', n: 'Units of Measure', d: 'UOM codes and classes — check before loading items and transactions.' },
    { r: 'inventoryStagedTransactions', a: 'INV', k: 'TXN', ops: 'GP', key: 'TransactionInterfaceId', n: 'Inventory Transactions', d: 'Misc. receipts / issues, subinventory and org transfers — staged and processed by Fusion.', f: 'InventoryTransactionImportTemplate' },
    { r: 'inventoryReservations', a: 'INV', k: 'TXN', ops: 'GPU', key: 'ReservationId', n: 'Reservations', d: 'Reserve on-hand stock against demand.', f: 'InventoryReservationImportTemplate' },
    { r: 'availableQuantityDetails', a: 'INV', k: 'TXN', ops: 'G', n: 'Available Quantity', d: 'On-hand and available-to-transact quantity per item, org, subinventory, locator, lot.' },
    // ── Order management
    { r: 'salesOrdersForOrderHub', a: 'OM', k: 'TXN', ops: 'GPU', ch: ['lines', 'billToCustomer', 'shipToCustomer'], key: 'HeaderId', n: 'Sales Orders', d: 'Create, revise and submit sales orders from any source system.', f: 'SourceSalesOrderImportTemplate' },
    { r: 'shipments', a: 'OM', k: 'TXN', ops: 'G', n: 'Shipments', d: 'Shipments and their lines — confirm what left the warehouse.' },
    { r: 'workOrders', a: 'OM', k: 'TXN', ops: 'GPU', key: 'WorkOrderId', n: 'Work Orders', d: 'Manufacturing work orders with operations and materials.' },
    // ── Costing
    { r: 'standardCosts', a: 'CST', k: 'MASTER', ops: 'G', n: 'Standard Costs', d: 'Published standard costs per item and cost organization.', f: 'StandardCostImportTemplate' },
    { r: 'itemCosts', a: 'CST', k: 'TXN', ops: 'G', n: 'Item Costs', d: 'Perpetual average / standard cost per item.' },
    // ── Projects
    { r: 'projects', a: 'PRJ', k: 'MASTER', ops: 'GPU', ch: ['Tasks', 'ProjectTeamMembers'], key: 'ProjectId', n: 'Projects', d: 'Projects with tasks and team members.', f: 'ProjectImportTemplate' },
    { r: 'projectBudgets', a: 'PRJ', k: 'TXN', ops: 'GP', key: 'PlanVersionId', n: 'Project Budgets', d: 'Budget versions with planning amounts.', f: 'ProjectBudgetsImportTemplate' },
    { r: 'unprocessedProjectCosts', a: 'PRJ', k: 'TXN', ops: 'GP', key: 'TransactionId', n: 'Project Costs (unprocessed)', d: 'Import labor, expense and usage costs into projects.' },
    { r: 'projectExpenditureItems', a: 'PRJ', k: 'TXN', ops: 'G', n: 'Expenditure Items', d: 'Processed project costs — check after a load.' },
    // ── HCM
    { r: 'locations', api: 'hcm', a: 'HCM', k: 'SETUP', ops: 'GPU', key: 'LocationId', n: 'Locations', d: 'Work, ship-to and bill-to locations.' },
    { r: 'jobs', api: 'hcm', a: 'HCM', k: 'SETUP', ops: 'GPU', key: 'JobId', n: 'Jobs', d: 'Jobs and job families.' },
    { r: 'positions', api: 'hcm', a: 'HCM', k: 'SETUP', ops: 'GPU', key: 'PositionId', n: 'Positions', d: 'Positions in departments.' },
    { r: 'grades', api: 'hcm', a: 'HCM', k: 'SETUP', ops: 'GPU', key: 'GradeId', n: 'Grades', d: 'Grades and grade steps.' },
    { r: 'workers', api: 'hcm', a: 'HCM', k: 'MASTER', ops: 'GPU', ch: ['names', 'emails', 'addresses', 'workRelationships'], key: 'PersonId', n: 'Workers', d: 'Hire workers with names, emails, addresses and assignments.' },
    { r: 'absences', api: 'hcm', a: 'HCM', k: 'TXN', ops: 'GPU', key: 'personAbsenceEntryId', n: 'Absences', d: 'Absence entries for workers.' },
    { r: 'elementEntries', api: 'hcm', a: 'HCM', k: 'TXN', ops: 'GPU', key: 'ElementEntryId', n: 'Element Entries', d: 'Payroll element entries (allowances, deductions).' },
    // ── Sales & service (customers)
    { r: 'accounts', api: 'crm', a: 'CRM', k: 'MASTER', ops: 'GPU', ch: ['Address', 'PrimaryAddress'], key: 'PartyNumber', n: 'Customer Accounts (CX)', d: 'Customer organizations with addresses.', f: 'CustomerImportTemplate' },
    { r: 'contacts', api: 'crm', a: 'CRM', k: 'MASTER', ops: 'GPU', key: 'PartyNumber', n: 'Contacts', d: 'People at customer accounts.' },
    // ── Integration services
    { r: 'erpintegrations', a: 'COM', k: 'UTIL', ops: 'GP', n: 'ERP Integrations (FBDI via REST)', d: 'Upload an FBDI ZIP, run the import job and read its status — the bridge between Prepare & Load and Fusion.' },
    { r: 'setupOfferingCSVExports', a: 'COM', k: 'UTIL', ops: 'GP', n: 'FSM Setup Exports', d: 'Export setup data of an offering (used by Setup Projects › Setup data).' }
];
