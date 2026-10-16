-- ============================================================
-- 66 — FUSION SQL: SETUP CHECKLIST — STARTER TASKS (83 tasks, 13 modules)
-- ============================================================
-- Inserts the starter setup tasks into WMS_FUSION_SETUP_TASKS (run 65 first).
-- Same list as fusionsql/setups-seed.js ("Load starter checklist" in the
-- Fusion Setups tab). Each INSERT is skipped when the task_code already
-- exists, so re-running never duplicates or overwrites edited tasks.
--
-- Check SQL returns the configured records; the task is DONE when it
-- returns >= min_rows rows on the Fusion pod. Review/edit per pod.
-- GENERATED from fusionsql/setups-seed.js — edit that file, then regenerate.
-- ============================================================

SET DEFINE OFF

-- ── Enterprise Structures (COMMON) ───────────────────────────
INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'COMMON_LEGAL_ENTITIES', 'COMMON', 'Enterprise Structures', 10, 'Legal entities', 'Manage Legal Entity',
       'At least one legal entity is defined.',
       q'[SELECT legal_entity_id, name, legal_entity_identifier FROM xle_entity_profiles]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'COMMON_LEGAL_ENTITIES');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'COMMON_BUSINESS_UNITS', 'COMMON', 'Enterprise Structures', 20, 'Business units', 'Manage Business Unit',
       'Business units exist.',
       q'[SELECT bu_id, bu_name FROM fun_all_business_units_v]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'COMMON_BUSINESS_UNITS');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'COMMON_REF_DATA_SETS', 'COMMON', 'Enterprise Structures', 30, 'Reference data sets', 'Manage Reference Data Sets',
       'Reference data sets (SetIDs) are defined.',
       q'[SELECT * FROM fnd_setid_sets]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'COMMON_REF_DATA_SETS');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'COMMON_LOCATIONS', 'COMMON', 'Enterprise Structures', 40, 'Locations', 'Manage Locations',
       'Work/ship/bill-to locations exist.',
       q'[SELECT * FROM hr_locations_all]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'COMMON_LOCATIONS');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'COMMON_CURRENCIES', 'COMMON', 'Enterprise Structures', 50, 'Enabled currencies', 'Manage Currencies',
       'Currencies enabled for use.',
       q'[SELECT currency_code, enabled_flag FROM fnd_currencies_b WHERE enabled_flag = 'Y']',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'COMMON_CURRENCIES');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'COMMON_INV_ORGS', 'COMMON', 'Enterprise Structures', 60, 'Inventory organizations', 'Manage Inventory Organizations',
       'Inventory organizations with parameters.',
       q'[SELECT organization_id, organization_code, master_organization_id FROM inv_org_parameters]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'COMMON_INV_ORGS');

-- ── General Ledger (GL) ──────────────────────────────────
INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'GL_LEDGERS', 'GL', 'General Ledger', 10, 'Ledgers', 'Manage Primary Ledgers',
       'Primary (and secondary) ledgers with currency, calendar and chart of accounts.',
       q'[SELECT ledger_id, name, ledger_category_code, currency_code, period_set_name, chart_of_accounts_id FROM gl_ledgers]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'GL_LEDGERS');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'GL_CALENDAR', 'GL', 'General Ledger', 20, 'Accounting calendar', 'Manage Accounting Calendars',
       'Accounting calendar periods are generated.',
       q'[SELECT period_set_name, period_name, period_year, start_date, end_date FROM gl_periods]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'GL_CALENDAR');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'GL_VALUE_SETS', 'GL', 'General Ledger', 30, 'Chart of accounts value sets', 'Manage Chart of Accounts Value Sets',
       'Value sets for the chart of accounts segments.',
       q'[SELECT * FROM fnd_vs_value_sets]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'GL_VALUE_SETS');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'GL_CODE_COMBINATIONS', 'GL', 'General Ledger', 40, 'Account combinations', 'Manage Account Combinations',
       'Enabled account code combinations exist.',
       q'[SELECT code_combination_id, chart_of_accounts_id, enabled_flag FROM gl_code_combinations WHERE enabled_flag = 'Y']',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'GL_CODE_COMBINATIONS');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'GL_OPEN_PERIODS', 'GL', 'General Ledger', 50, 'Open GL period', 'Manage Accounting Periods',
       'At least one General Ledger period is open.',
       q'[SELECT l.name AS ledger, ps.period_name, ps.closing_status FROM gl_period_statuses ps JOIN gl_ledgers l ON l.ledger_id = ps.ledger_id WHERE ps.application_id = 101 AND ps.closing_status = 'O']',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'GL_OPEN_PERIODS');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'GL_JE_SOURCES', 'GL', 'General Ledger', 60, 'Journal sources', 'Manage Journal Sources',
       'Journal sources are defined.',
       q'[SELECT * FROM gl_je_sources_b]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'GL_JE_SOURCES');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'GL_JE_CATEGORIES', 'GL', 'General Ledger', 70, 'Journal categories', 'Manage Journal Categories',
       'Journal categories are defined.',
       q'[SELECT * FROM gl_je_categories_b]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'GL_JE_CATEGORIES');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'GL_DAILY_RATES', 'GL', 'General Ledger', 80, 'Daily conversion rates (last 30 days)', 'Manage Daily Rates',
       'Recent daily currency conversion rates are loaded.',
       q'[SELECT from_currency, to_currency, conversion_type, conversion_date, conversion_rate FROM gl_daily_rates WHERE conversion_date >= TRUNC(SYSDATE) - 30]',
       'N', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'GL_DAILY_RATES');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'GL_JOURNALS_POSTED', 'GL', 'General Ledger', 90, 'Posted journals', 'Create Journal',
       'Journals have been posted (usage check).',
       q'[SELECT je_header_id, name, period_name, status FROM gl_je_headers WHERE status = 'P']',
       'N', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'GL_JOURNALS_POSTED');

-- ── Tax (TAX) ─────────────────────────────────────────────
INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'TAX_REGIMES', 'TAX', 'Tax', 10, 'Tax regimes', 'Manage Tax Regimes',
       'Tax regimes are defined.',
       q'[SELECT * FROM zx_regimes_b]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'TAX_REGIMES');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'TAX_TAXES', 'TAX', 'Tax', 20, 'Taxes', 'Manage Taxes',
       'Taxes are defined within the regimes.',
       q'[SELECT * FROM zx_taxes_b]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'TAX_TAXES');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'TAX_STATUSES', 'TAX', 'Tax', 30, 'Tax statuses', 'Manage Tax Statuses',
       'Tax statuses are defined.',
       q'[SELECT * FROM zx_status_b]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'TAX_STATUSES');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'TAX_RATES', 'TAX', 'Tax', 40, 'Tax rates', 'Manage Tax Rates and Tax Recovery Rates',
       'Tax rates are defined.',
       q'[SELECT * FROM zx_rates_b]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'TAX_RATES');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'TAX_JURISDICTIONS', 'TAX', 'Tax', 50, 'Tax jurisdictions', 'Manage Tax Jurisdictions',
       'Tax jurisdictions are defined.',
       q'[SELECT * FROM zx_jurisdictions_b]',
       'N', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'TAX_JURISDICTIONS');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'TAX_PARTY_PROFILES', 'TAX', 'Tax', 60, 'Party tax profiles', 'Manage Party Tax Profiles',
       'Legal entity / BU tax profiles exist.',
       q'[SELECT * FROM zx_party_tax_profile]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'TAX_PARTY_PROFILES');

-- ── Cash Management (CM) ─────────────────────────────────
INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'CM_BANK_BRANCHES', 'CM', 'Cash Management', 10, 'Banks and branches', 'Manage Bank Branches',
       'Banks and bank branches are defined.',
       q'[SELECT * FROM ce_bank_branches_v]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'CM_BANK_BRANCHES');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'CM_BANK_ACCOUNTS', 'CM', 'Cash Management', 20, 'Internal bank accounts', 'Manage Bank Accounts',
       'Company bank accounts are defined.',
       q'[SELECT bank_account_id, bank_account_name, bank_account_num, currency_code FROM ce_bank_accounts]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'CM_BANK_ACCOUNTS');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'CM_BANK_ACCT_USES', 'CM', 'Cash Management', 30, 'Bank account uses (BU access)', 'Manage Bank Accounts',
       'Bank accounts are granted to business units.',
       q'[SELECT * FROM ce_bank_acct_uses_all]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'CM_BANK_ACCT_USES');

-- ── Payables (AP) ────────────────────────────────────────
INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'AP_FIN_OPTIONS', 'AP', 'Payables', 10, 'Common options for Payables and Procurement', 'Manage Common Options for Payables and Procurement',
       'Financials options exist per business unit.',
       q'[SELECT * FROM financials_system_params_all]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'AP_FIN_OPTIONS');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'AP_OPTIONS', 'AP', 'Payables', 20, 'Invoice / payment options', 'Manage Invoice Options',
       'Payables system options exist per business unit.',
       q'[SELECT * FROM ap_system_parameters_all]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'AP_OPTIONS');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'AP_TERMS', 'AP', 'Payables', 30, 'Payment terms', 'Manage Payables Payment Terms',
       'Payables payment terms are defined.',
       q'[SELECT * FROM ap_terms_b]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'AP_TERMS');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'AP_TOLERANCES', 'AP', 'Payables', 40, 'Invoice tolerances', 'Manage Invoice Tolerances',
       'Invoice tolerance templates are defined.',
       q'[SELECT * FROM ap_tolerance_templates]',
       'N', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'AP_TOLERANCES');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'AP_DIST_SETS', 'AP', 'Payables', 50, 'Distribution sets', 'Manage Distribution Sets',
       'Distribution sets are defined.',
       q'[SELECT * FROM ap_distribution_sets_all]',
       'N', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'AP_DIST_SETS');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'AP_PAYMENT_METHODS', 'AP', 'Payables', 60, 'Payment methods', 'Manage Payment Methods',
       'Payment methods are defined.',
       q'[SELECT * FROM iby_payment_methods_b]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'AP_PAYMENT_METHODS');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'AP_PPP', 'AP', 'Payables', 70, 'Payment process profiles', 'Manage Payment Process Profiles',
       'Payment process profiles are defined.',
       q'[SELECT * FROM iby_acct_pmt_profiles_b]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'AP_PPP');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'AP_SUPPLIERS', 'AP', 'Payables', 80, 'Suppliers', 'Manage Suppliers',
       'Suppliers exist.',
       q'[SELECT vendor_id, segment1 AS supplier_number, party_id FROM poz_suppliers]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'AP_SUPPLIERS');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'AP_SUPPLIER_SITES', 'AP', 'Payables', 90, 'Supplier sites', 'Manage Suppliers',
       'Supplier sites exist (needed to invoice and pay).',
       q'[SELECT * FROM poz_supplier_sites_all_m]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'AP_SUPPLIER_SITES');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'AP_OPEN_PERIODS', 'AP', 'Payables', 100, 'Open Payables period', 'Manage Payables Accounting Periods',
       'At least one Payables period is open.',
       q'[SELECT l.name AS ledger, ps.period_name, ps.closing_status FROM gl_period_statuses ps JOIN gl_ledgers l ON l.ledger_id = ps.ledger_id WHERE ps.application_id = 200 AND ps.closing_status = 'O']',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'AP_OPEN_PERIODS');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'AP_INVOICES', 'AP', 'Payables', 110, 'Invoices entered', 'Manage Invoices',
       'Payables invoices exist (usage check).',
       q'[SELECT invoice_id, invoice_num, invoice_amount FROM ap_invoices_all]',
       'N', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'AP_INVOICES');

-- ── Receivables (AR) ─────────────────────────────────────
INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'AR_SYS_OPTIONS', 'AR', 'Receivables', 10, 'Receivables system options', 'Manage Receivables System Options',
       'System options exist per business unit.',
       q'[SELECT * FROM ar_system_parameters_all]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'AR_SYS_OPTIONS');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'AR_TRX_TYPES', 'AR', 'Receivables', 20, 'Transaction types', 'Manage Transaction Types',
       'Invoice / credit memo transaction types are defined.',
       q'[SELECT cust_trx_type_id, name, type FROM ra_cust_trx_types_all]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'AR_TRX_TYPES');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'AR_TRX_SOURCES', 'AR', 'Receivables', 30, 'Transaction sources', 'Manage Transaction Sources',
       'Transaction (batch) sources are defined.',
       q'[SELECT batch_source_id, name FROM ra_batch_sources_all]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'AR_TRX_SOURCES');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'AR_AUTOACCOUNTING', 'AR', 'Receivables', 40, 'AutoAccounting rules', 'Manage AutoAccounting Rules',
       'AutoAccounting is defined.',
       q'[SELECT * FROM ra_account_defaults_all]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'AR_AUTOACCOUNTING');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'AR_TERMS', 'AR', 'Receivables', 50, 'Receivables payment terms', 'Manage Receivables Payment Terms',
       'Receivables payment terms are defined.',
       q'[SELECT * FROM ra_terms_b]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'AR_TERMS');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'AR_RECEIPT_CLASSES', 'AR', 'Receivables', 60, 'Receipt classes', 'Manage Receipt Classes and Methods',
       'Receipt classes are defined.',
       q'[SELECT receipt_class_id, name FROM ar_receipt_classes]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'AR_RECEIPT_CLASSES');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'AR_RECEIPT_METHODS', 'AR', 'Receivables', 70, 'Receipt methods', 'Manage Receipt Classes and Methods',
       'Receipt methods are defined.',
       q'[SELECT receipt_method_id, name FROM ar_receipt_methods]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'AR_RECEIPT_METHODS');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'AR_REMIT_TO', 'AR', 'Receivables', 80, 'Remit-to addresses', 'Manage Remit-to Addresses',
       'Remit-to addresses are defined.',
       q'[SELECT * FROM ar_remit_to_locs_all]',
       'N', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'AR_REMIT_TO');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'AR_CUSTOMERS', 'AR', 'Receivables', 90, 'Customer accounts', 'Manage Customers',
       'Customer accounts exist.',
       q'[SELECT cust_account_id, account_number, account_name, status FROM hz_cust_accounts]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'AR_CUSTOMERS');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'AR_CUSTOMER_SITES', 'AR', 'Receivables', 100, 'Customer account sites', 'Manage Customers',
       'Customer account sites exist (bill-to/ship-to).',
       q'[SELECT * FROM hz_cust_acct_sites_all]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'AR_CUSTOMER_SITES');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'AR_OPEN_PERIODS', 'AR', 'Receivables', 110, 'Open Receivables period', 'Manage Receivables Accounting Periods',
       'At least one Receivables period is open.',
       q'[SELECT l.name AS ledger, ps.period_name, ps.closing_status FROM gl_period_statuses ps JOIN gl_ledgers l ON l.ledger_id = ps.ledger_id WHERE ps.application_id = 222 AND ps.closing_status = 'O']',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'AR_OPEN_PERIODS');

-- ── Fixed Assets (FA) ────────────────────────────────────
INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'FA_BOOKS', 'FA', 'Fixed Assets', 10, 'Asset books', 'Manage Asset Books',
       'Corporate (and tax) asset books are defined.',
       q'[SELECT book_type_code, book_class FROM fa_book_controls]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'FA_BOOKS');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'FA_CATEGORIES', 'FA', 'Fixed Assets', 20, 'Asset categories', 'Manage Asset Categories',
       'Asset categories are defined.',
       q'[SELECT * FROM fa_categories_b]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'FA_CATEGORIES');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'FA_METHODS', 'FA', 'Fixed Assets', 30, 'Depreciation methods', 'Manage Depreciation Methods',
       'Depreciation methods are defined.',
       q'[SELECT * FROM fa_methods]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'FA_METHODS');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'FA_CALENDARS', 'FA', 'Fixed Assets', 40, 'Asset calendars', 'Manage Asset Calendars',
       'Asset calendars are defined.',
       q'[SELECT * FROM fa_calendar_types]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'FA_CALENDARS');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'FA_LOCATIONS', 'FA', 'Fixed Assets', 50, 'Asset locations', 'Manage Asset Locations',
       'Asset locations are defined.',
       q'[SELECT * FROM fa_locations]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'FA_LOCATIONS');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'FA_OPEN_PERIODS', 'FA', 'Fixed Assets', 60, 'Open depreciation period', 'Manage Asset Calendars',
       'Each book has an open depreciation period.',
       q'[SELECT book_type_code, period_name, period_open_date FROM fa_deprn_periods WHERE period_close_date IS NULL]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'FA_OPEN_PERIODS');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'FA_ASSETS', 'FA', 'Fixed Assets', 70, 'Assets added', 'Manage Assets',
       'Assets exist (usage check).',
       q'[SELECT * FROM fa_additions_b]',
       'N', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'FA_ASSETS');

-- ── Procurement (PO) ─────────────────────────────────────
INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'PO_BUYERS', 'PO', 'Procurement', 10, 'Procurement agents (buyers)', 'Manage Procurement Agents',
       'Buyers are defined.',
       q'[SELECT * FROM po_agents]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'PO_BUYERS');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'PO_DOC_STYLES', 'PO', 'Procurement', 20, 'Purchasing document styles', 'Manage Purchasing Document Styles',
       'Document styles are defined.',
       q'[SELECT * FROM po_doc_style_headers]',
       'N', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'PO_DOC_STYLES');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'PO_LINE_TYPES', 'PO', 'Procurement', 30, 'Purchasing line types', 'Manage Purchasing Line Types',
       'Line types (goods/services) are defined.',
       q'[SELECT * FROM po_line_types_b]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'PO_LINE_TYPES');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'PO_RCV_PARAMS', 'PO', 'Procurement', 40, 'Receiving parameters', 'Manage Receiving Parameters',
       'Receiving parameters exist per inventory organization.',
       q'[SELECT * FROM rcv_parameters]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'PO_RCV_PARAMS');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'PO_REQUISITIONS', 'PO', 'Procurement', 50, 'Requisitions created', 'Manage Requisitions',
       'Requisitions exist (usage check).',
       q'[SELECT * FROM por_requisition_headers_all]',
       'N', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'PO_REQUISITIONS');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'PO_ORDERS', 'PO', 'Procurement', 60, 'Purchase orders created', 'Manage Orders',
       'Purchase orders exist (usage check).',
       q'[SELECT po_header_id, segment1 AS po_number FROM po_headers_all]',
       'N', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'PO_ORDERS');

-- ── Inventory (INV) ───────────────────────────────────────
INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'INV_ORGS', 'INV', 'Inventory', 10, 'Inventory organization parameters', 'Manage Inventory Organization Parameters',
       'Organizations have inventory parameters.',
       q'[SELECT organization_id, organization_code, master_organization_id FROM inv_org_parameters]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'INV_ORGS');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'INV_SUBINVENTORIES', 'INV', 'Inventory', 20, 'Subinventories', 'Manage Subinventories and Locators',
       'Subinventories are defined.',
       q'[SELECT organization_id, secondary_inventory_name FROM inv_secondary_inventories]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'INV_SUBINVENTORIES');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'INV_LOCATORS', 'INV', 'Inventory', 30, 'Locators', 'Manage Subinventories and Locators',
       'Stock locators are defined (if locator control is used).',
       q'[SELECT inventory_location_id, organization_id, subinventory_code FROM inv_item_locations]',
       'N', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'INV_LOCATORS');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'INV_UOMS', 'INV', 'Inventory', 40, 'Units of measure', 'Manage Units of Measure',
       'Units of measure are defined.',
       q'[SELECT * FROM inv_units_of_measure_b]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'INV_UOMS');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'INV_UOM_CONVERSIONS', 'INV', 'Inventory', 50, 'UOM conversions', 'Manage Unit of Measure Conversions',
       'Unit of measure conversions are defined.',
       q'[SELECT * FROM inv_uom_conversions]',
       'N', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'INV_UOM_CONVERSIONS');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'INV_TXN_TYPES', 'INV', 'Inventory', 60, 'Transaction types', 'Manage Transaction Types',
       'Inventory transaction types are available.',
       q'[SELECT * FROM inv_transaction_types_b]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'INV_TXN_TYPES');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'INV_ITEM_CLASSES', 'INV', 'Inventory', 70, 'Item classes', 'Manage Item Classes',
       'Item classes are defined.',
       q'[SELECT * FROM egp_item_classes_b]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'INV_ITEM_CLASSES');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'INV_CATEGORY_SETS', 'INV', 'Inventory', 80, 'Catalogs (category sets)', 'Manage Catalogs',
       'Item catalogs / category sets are defined.',
       q'[SELECT * FROM egp_category_sets_b]',
       'N', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'INV_CATEGORY_SETS');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'INV_ITEMS', 'INV', 'Inventory', 90, 'Items', 'Manage Items',
       'Items exist in the item master.',
       q'[SELECT inventory_item_id, item_number, organization_id FROM egp_system_items_b]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'INV_ITEMS');

-- ── Shipping (SHIP) ────────────────────────────────────────
INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'SHIP_CARRIERS', 'SHIP', 'Shipping', 10, 'Carriers', 'Manage Carriers',
       'Carriers are defined.',
       q'[SELECT * FROM wsh_carriers]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'SHIP_CARRIERS');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'SHIP_CARRIER_SERVICES', 'SHIP', 'Shipping', 20, 'Carrier ship methods', 'Manage Carriers',
       'Carrier services / ship methods are defined.',
       q'[SELECT * FROM wsh_carrier_services]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'SHIP_CARRIER_SERVICES');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'SHIP_PICK_RULES', 'SHIP', 'Shipping', 30, 'Pick release rules', 'Manage Release Rules',
       'Pick release rules are defined.',
       q'[SELECT * FROM wsh_picking_rules]',
       'N', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'SHIP_PICK_RULES');

-- ── Order Management (OM) ────────────────────────────────
INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'OM_ORDER_TYPES', 'OM', 'Order Management', 10, 'Order types', 'Manage Order Lookups',
       'Order types (lookup ORA_DOO_ORDER_TYPES) are defined.',
       q'[SELECT lookup_code, enabled_flag FROM fnd_lookup_values_b WHERE lookup_type = 'ORA_DOO_ORDER_TYPES']',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'OM_ORDER_TYPES');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'OM_PRICE_LISTS', 'OM', 'Order Management', 20, 'Price lists', 'Manage Price Lists',
       'Price lists are defined.',
       q'[SELECT * FROM qp_price_lists_b]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'OM_PRICE_LISTS');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'OM_SALESPERSONS', 'OM', 'Order Management', 30, 'Salespersons', 'Manage Salespersons',
       'Salespersons are defined.',
       q'[SELECT * FROM jtf_rs_salesreps]',
       'N', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'OM_SALESPERSONS');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'OM_ORDERS', 'OM', 'Order Management', 40, 'Sales orders created', 'Manage Orders',
       'Sales orders exist (usage check).',
       q'[SELECT header_id, order_number, status_code FROM doo_headers_all]',
       'N', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'OM_ORDERS');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'OM_FULFILL_LINES', 'OM', 'Order Management', 50, 'Fulfillment lines', 'Manage Orders',
       'Orders have fulfillment lines (usage check).',
       q'[SELECT * FROM doo_fulfill_lines_all]',
       'N', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'OM_FULFILL_LINES');

-- ── Users & Security (SEC) ────────────────────────────────
INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'SEC_USERS', 'SEC', 'Users & Security', 10, 'Users', 'Manage Users',
       'Application users exist.',
       q'[SELECT user_id, username, active_flag FROM per_users WHERE active_flag = 'Y']',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'SEC_USERS');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'SEC_USER_ROLES', 'SEC', 'Users & Security', 20, 'Role provisioning', 'Manage Users',
       'Users have roles provisioned.',
       q'[SELECT * FROM per_user_roles]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'SEC_USER_ROLES');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'SEC_ROLES', 'SEC', 'Users & Security', 30, 'Roles', 'Manage Job Roles',
       'Roles are available.',
       q'[SELECT * FROM per_roles_dn]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'SEC_ROLES');

-- ── HCM Core (HCM) ────────────────────────────────────────
INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'HCM_PERSONS', 'HCM', 'HCM Core', 10, 'Persons (workers)', 'Hire an Employee',
       'Person records exist.',
       q'[SELECT person_id, person_number FROM per_all_people_f WHERE SYSDATE BETWEEN effective_start_date AND effective_end_date]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'HCM_PERSONS');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'HCM_ASSIGNMENTS', 'HCM', 'HCM Core', 20, 'Assignments', 'Hire an Employee',
       'Worker assignments exist.',
       q'[SELECT * FROM per_all_assignments_m WHERE SYSDATE BETWEEN effective_start_date AND effective_end_date]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'HCM_ASSIGNMENTS');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'HCM_JOBS', 'HCM', 'HCM Core', 30, 'Jobs', 'Manage Jobs',
       'Jobs are defined.',
       q'[SELECT * FROM per_jobs_f]',
       'N', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'HCM_JOBS');

INSERT INTO wms_fusion_setup_tasks (task_code, module_code, module_name, seq, task_name, fsm_task, description, check_sql, mandatory, min_rows, source, created_by)
SELECT 'HCM_DEPARTMENTS', 'HCM', 'HCM Core', 40, 'Departments / organizations', 'Manage Departments',
       'HR organizations are defined.',
       q'[SELECT * FROM hr_all_organization_units_f]',
       'Y', 1, 'STARTER', 'SEED_SCRIPT'
FROM dual WHERE NOT EXISTS (SELECT 1 FROM wms_fusion_setup_tasks WHERE task_code = 'HCM_DEPARTMENTS');

COMMIT;

-- Check what was loaded:
-- SELECT module_code, COUNT(*) AS tasks, SUM(CASE WHEN mandatory = 'Y' THEN 1 ELSE 0 END) AS mandatory
-- FROM   wms_fusion_setup_tasks GROUP BY module_code ORDER BY module_code;
