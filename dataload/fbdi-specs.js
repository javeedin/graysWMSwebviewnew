/* FBDI specs for "Prepare & Load" — generated from Oracle's 26C .xlsm workbooks:
   column bubble text = DB column, type, length, NOT NULL, help; row 5 = Oracle's example; ex = Oracle's sample rows;
   ins = the Instructions sheet; csv/zip names and the trailing END column from the workbook macro. Do not edit by hand.

   FBDI_SPEC_INDEX lists every template: ok:1 → a spec file specs/<File>.js exists (loaded on demand by fbdiSpec());
   ok:0 → Oracle's macro writes something other than one CSV per sheet, so the app cannot rebuild it yet (why). */
window.FBDI_SPECS = window.FBDI_SPECS || {};
window.FBDI_SPEC_INDEX = {
  "AccountCombinationsImportTemplate":{"cols":61,"ok":1,"sheets":1},
  "AutoInvoiceImportTemplate":{"cols":591,"ok":1,"sheets":4},
  "BudgetImportTemplate":{"cols":379,"ok":1,"sheets":2},
  "CashManagementBankStatementImportTemplate":{"cols":159,"ok":1,"sheets":6},
  "ChartOfAccountsSegmentValuesAndHierarchiesImportTemplate":{"cols":138,"ok":1,"sheets":2},
  "CrossValidationRulesImportTemplate":{"ok":0,"why":"Oracle's macro writes a special text format"},
  "CustomerImportTemplate":{"cols":1254,"ok":1,"sheets":19},
  "CycleCountImportTemplate":{"cols":97,"ok":1,"sheets":1},
  "DailyRatesImportTemplate":{"cols":33,"ok":1,"sheets":1},
  "FixedAssetMassAdditionsImportTemplate":{"cols":493,"ok":1,"sheets":3},
  "FixedAssetMassAdjustmentsImportTemplate":{"cols":367,"ok":1,"sheets":3},
  "FixedAssetMassRetirementsImportTemplate":{"cols":157,"ok":1,"sheets":3},
  "FixedAssetMassTransfersImportTemplate":{"cols":176,"ok":1,"sheets":3},
  "GeneralLedgerBudgetBalanceImportTemplate":{"cols":39,"ok":1,"sheets":1},
  "IntercompanyTransactionImportTemplate":{"ok":0,"why":"Oracle's macro writes all 5 sheets into one CSV"},
  "InventoryReservationImportTemplate":{"cols":131,"ok":1,"sheets":1},
  "InventoryTransactionImportTemplate":{"cols":536,"ok":1,"sheets":4},
  "ItemImportTemplate":{"cols":1365,"ok":1,"sheets":17},
  "ItemStructureImportTemplate":{"cols":307,"ok":1,"sheets":4},
  "JournalImportTemplate":{"cols":149,"ok":1,"sheets":1},
  "LeaseContractImportTemplate":{"cols":452,"ok":1,"sheets":13},
  "POBlanketPurchaseAgreementImportTemplate":{"cols":370,"ok":1,"sheets":6},
  "POContractPurchaseAgreementImportTemplate":{"cols":117,"ok":1,"sheets":2},
  "POPurchaseOrderImportTemplate":{"cols":540,"ok":1,"sheets":4},
  "PayablesPaymentRequestImportTemplate":{"cols":131,"ok":1,"sheets":1},
  "PayablesStandardInvoiceImportTemplate":{"cols":301,"ok":1,"sheets":2},
  "PriceListImportTemplate":{"cols":378,"ok":1,"sheets":10},
  "ProjectBudgetsImportTemplate":{"cols":61,"ok":1,"sheets":1},
  "ProjectForecastsImportTemplate":{"cols":58,"ok":1,"sheets":1},
  "ProjectImportTemplate":{"ok":0,"why":"Oracle's macro builds its CSV names at run time"},
  "ProjectPlanImportTemplate":{"cols":353,"ok":1,"sheets":1},
  "ProjectProgressImportTemplate":{"cols":48,"ok":1,"sheets":1},
  "ProjectTransactionControlsImportTemplate":{"cols":19,"ok":1,"sheets":1},
  "ReceivablesStandardReceiptImportTemplate":{"ok":0,"why":"Lockbox uses a fixed record format, not one CSV per sheet"},
  "ReceivingReceiptImportTemplate":{"cols":515,"ok":1,"sheets":5},
  "RequisitionImportTemplate":{"cols":419,"ok":1,"sheets":3},
  "ScpPlannersImportTemplate":{"cols":5,"ok":1,"sheets":1},
  "ShipmentRequestImportTemplate":{"cols":261,"ok":1,"sheets":2},
  "SourceSalesOrderImportTemplate":{"cols":625,"ok":1,"sheets":17},
  "StandardCostImportTemplate":{"cols":16,"ok":1,"sheets":2},
  "SupplierAddressImportTemplate":{"cols":110,"ok":1,"sheets":1},
  "SupplierAttachmentImportTemplate":{"cols":33,"ok":1,"sheets":3},
  "SupplierBankAccountImportTemplate":{"cols":67,"ok":1,"sheets":3},
  "SupplierBusinessClassificationImportTemplate":{"cols":18,"ok":1,"sheets":1},
  "SupplierContactImportTemplate":{"cols":97,"ok":1,"sheets":2},
  "SupplierImportTemplate":{"cols":156,"ok":1,"sheets":1},
  "SupplierProductsAndServicesCategoryImportTemplate":{"cols":5,"ok":1,"sheets":1},
  "SupplierSiteAssignmentImportTemplate":{"cols":16,"ok":1,"sheets":1},
  "SupplierSiteImportTemplate":{"cols":211,"ok":1,"sheets":2}};

/** Load a template's spec on demand → Promise(spec). Resolves at once when it is already loaded. */
var _fbdiSpecWait = {};
function fbdiSpec(tpl) {
    if (FBDI_SPECS[tpl]) return Promise.resolve(FBDI_SPECS[tpl]);
    var ix = FBDI_SPEC_INDEX[tpl];
    if (!ix) return Promise.reject('Template ' + tpl + ' is not known to this version of the app');
    if (!ix.ok) return Promise.reject(tpl + ' cannot be prepared here yet: ' + ix.why);
    if (_fbdiSpecWait[tpl]) return _fbdiSpecWait[tpl];
    return (_fbdiSpecWait[tpl] = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = 'specs/' + tpl + '.js';
        s.onload = function () { FBDI_SPECS[tpl] ? resolve(FBDI_SPECS[tpl]) : reject('The spec file of ' + tpl + ' is empty'); };
        s.onerror = function () { delete _fbdiSpecWait[tpl]; reject('Could not load specs/' + tpl + '.js — is the app install complete?'); };
        document.head.appendChild(s);
    }));
}
function fbdiSupported(tpl) { var ix = FBDI_SPEC_INDEX[tpl]; return !!(ix && ix.ok); }
