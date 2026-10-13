-- User access to modules (Admin › User Access, Home/access.js). The Admin page and Home create all of this themselves;
-- this file is the same for a DBA. Logins are kept upper-case. Home shows a login only the modules with an active row.

CREATE TABLE wms_app_modules (module_code VARCHAR2(60) PRIMARY KEY, title VARCHAR2(200), group_name VARCHAR2(60), href VARCHAR2(300), description VARCHAR2(1000), sort_n NUMBER, active VARCHAR2(1) DEFAULT 'Y', created_at DATE DEFAULT SYSDATE, changed_date DATE);

CREATE TABLE wms_user_module_access (app_user VARCHAR2(100) NOT NULL, module_code VARCHAR2(60) NOT NULL, active VARCHAR2(1) DEFAULT 'Y', granted_by VARCHAR2(100), granted_at DATE DEFAULT SYSDATE, revoked_by VARCHAR2(100), revoked_at DATE, note VARCHAR2(400), changed_by VARCHAR2(100), changed_date DATE DEFAULT SYSDATE, CONSTRAINT wms_user_module_access_pk PRIMARY KEY (app_user, module_code));

CREATE TABLE wms_user_access_log (log_id VARCHAR2(40) PRIMARY KEY, app_user VARCHAR2(100), module_code VARCHAR2(60), action VARCHAR2(20), by_user VARCHAR2(100), machine VARCHAR2(100), note VARCHAR2(400), logged_at DATE DEFAULT SYSDATE);

CREATE INDEX wms_user_access_log_u ON wms_user_access_log (app_user, logged_at);

-- the modules = the Home tiles
MERGE INTO wms_app_modules t USING (SELECT 'wms' AS module_code FROM dual) s ON (t.module_code = s.module_code)
  WHEN NOT MATCHED THEN INSERT (module_code, title, group_name, href, description, sort_n, active, created_at) VALUES ('wms', 'Warehouse Management', 'Warehouse & Orders', '../wms/index.html', 'Trip management, print jobs, printers', 1, 'Y', SYSDATE);
MERGE INTO wms_app_modules t USING (SELECT 'wms2' AS module_code FROM dual) s ON (t.module_code = s.module_code)
  WHEN NOT MATCHED THEN INSERT (module_code, title, group_name, href, description, sort_n, active, created_at) VALUES ('wms2', 'WMS 2.0', 'Warehouse & Orders', '../wms2/index.html', 'Control tower for a trip date', 2, 'Y', SYSDATE);
MERGE INTO wms_app_modules t USING (SELECT 'wms2-tomorrow' AS module_code FROM dual) s ON (t.module_code = s.module_code)
  WHEN NOT MATCHED THEN INSERT (module_code, title, group_name, href, description, sort_n, active, created_at) VALUES ('wms2-tomorrow', 'Tomorrow Check', 'Warehouse & Orders', '../wms2/index.html#tomorrow', 'Tomorrow''s failures, fixed tonight', 3, 'Y', SYSDATE);
MERGE INTO wms_app_modules t USING (SELECT 'om' AS module_code FROM dual) s ON (t.module_code = s.module_code)
  WHEN NOT MATCHED THEN INSERT (module_code, title, group_name, href, description, sort_n, active, created_at) VALUES ('om', 'Order Management', 'Warehouse & Orders', '../om/index.html', 'Order pad, approvals, Fusion orders', 4, 'Y', SYSDATE);
MERGE INTO wms_app_modules t USING (SELECT 'Inventory' AS module_code FROM dual) s ON (t.module_code = s.module_code)
  WHEN NOT MATCHED THEN INSERT (module_code, title, group_name, href, description, sort_n, active, created_at) VALUES ('Inventory', 'Inventory', 'Warehouse & Orders', '../Inventory/index.html', 'Items, on-hand, transactions, receiving', 5, 'Y', SYSDATE);
MERGE INTO wms_app_modules t USING (SELECT 'fieldapps' AS module_code FROM dual) s ON (t.module_code = s.module_code)
  WHEN NOT MATCHED THEN INSERT (module_code, title, group_name, href, description, sort_n, active, created_at) VALUES ('fieldapps', 'Field Apps', 'Warehouse & Orders', '../fieldapps/index.html', 'Apps and the POS for the pickers'' phones', 6, 'Y', SYSDATE);
MERGE INTO wms_app_modules t USING (SELECT 'crm' AS module_code FROM dual) s ON (t.module_code = s.module_code)
  WHEN NOT MATCHED THEN INSERT (module_code, title, group_name, href, description, sort_n, active, created_at) VALUES ('crm', 'Customer CRM', 'Warehouse & Orders', '../crm/index.html', 'Customers, tickets, calls, opportunities', 7, 'Y', SYSDATE);
MERGE INTO wms_app_modules t USING (SELECT 'saleslens' AS module_code FROM dual) s ON (t.module_code = s.module_code)
  WHEN NOT MATCHED THEN INSERT (module_code, title, group_name, href, description, sort_n, active, created_at) VALUES ('saleslens', 'Sales Lens', 'Warehouse & Orders', '../saleslens/index.html', 'Missed sales, causes, lost margin, simulations', 8, 'Y', SYSDATE);
MERGE INTO wms_app_modules t USING (SELECT 'finance' AS module_code FROM dual) s ON (t.module_code = s.module_code)
  WHEN NOT MATCHED THEN INSERT (module_code, title, group_name, href, description, sort_n, active, created_at) VALUES ('finance', 'Finance Lens', 'Finance', '../finance/index.html', 'Statements, KPIs, board packs', 8, 'Y', SYSDATE);
MERGE INTO wms_app_modules t USING (SELECT 'debtors' AS module_code FROM dual) s ON (t.module_code = s.module_code)
  WHEN NOT MATCHED THEN INSERT (module_code, title, group_name, href, description, sort_n, active, created_at) VALUES ('debtors', 'Fusion Debtors Control', 'Finance', '../debtors/index.html', 'Customer statements and follow-ups', 9, 'Y', SYSDATE);
MERGE INTO wms_app_modules t USING (SELECT 'fscm-om' AS module_code FROM dual) s ON (t.module_code = s.module_code)
  WHEN NOT MATCHED THEN INSERT (module_code, title, group_name, href, description, sort_n, active, created_at) VALUES ('fscm-om', 'Fusion Order Management', 'Oracle Fusion', '../fscm/om.html', 'Order Hub, POS order, customers', 10, 'Y', SYSDATE);
MERGE INTO wms_app_modules t USING (SELECT 'fscm-shipping' AS module_code FROM dual) s ON (t.module_code = s.module_code)
  WHEN NOT MATCHED THEN INSERT (module_code, title, group_name, href, description, sort_n, active, created_at) VALUES ('fscm-shipping', 'Fusion Shipping', 'Oracle Fusion', '../fscm/shipping.html', 'Pick release, confirm, ship confirm', 11, 'Y', SYSDATE);
MERGE INTO wms_app_modules t USING (SELECT 'fscm-purchasing' AS module_code FROM dual) s ON (t.module_code = s.module_code)
  WHEN NOT MATCHED THEN INSERT (module_code, title, group_name, href, description, sort_n, active, created_at) VALUES ('fscm-purchasing', 'Fusion Purchasing', 'Oracle Fusion', '../fscm/purchasing.html', 'POs, receipts, suppliers', 12, 'Y', SYSDATE);
MERGE INTO wms_app_modules t USING (SELECT 'fscm-inventory' AS module_code FROM dual) s ON (t.module_code = s.module_code)
  WHEN NOT MATCHED THEN INSERT (module_code, title, group_name, href, description, sort_n, active, created_at) VALUES ('fscm-inventory', 'Fusion Inventory', 'Oracle Fusion', '../fscm/inventory.html', 'Item master, on-hand, transfers', 13, 'Y', SYSDATE);
MERGE INTO wms_app_modules t USING (SELECT 'fscm-costing' AS module_code FROM dual) s ON (t.module_code = s.module_code)
  WHEN NOT MATCHED THEN INSERT (module_code, title, group_name, href, description, sort_n, active, created_at) VALUES ('fscm-costing', 'Fusion Costing', 'Oracle Fusion', '../fscm/costing.html', 'Item and receipt costs', 14, 'Y', SYSDATE);
MERGE INTO wms_app_modules t USING (SELECT 'fscm-setup' AS module_code FROM dual) s ON (t.module_code = s.module_code)
  WHEN NOT MATCHED THEN INSERT (module_code, title, group_name, href, description, sort_n, active, created_at) VALUES ('fscm-setup', 'Fusion Setup & Diagnostics', 'Oracle Fusion', '../fscm/setup.html', 'Business units, setup explorer, UAT', 15, 'Y', SYSDATE);
MERGE INTO wms_app_modules t USING (SELECT 'fusionsql' AS module_code FROM dual) s ON (t.module_code = s.module_code)
  WHEN NOT MATCHED THEN INSERT (module_code, title, group_name, href, description, sort_n, active, created_at) VALUES ('fusionsql', 'Fusion SQL', 'Oracle Fusion', '../fusionsql/index.html', 'Read-only SQL on Oracle Fusion', 16, 'Y', SYSDATE);
MERGE INTO wms_app_modules t USING (SELECT 'bip' AS module_code FROM dual) s ON (t.module_code = s.module_code)
  WHEN NOT MATCHED THEN INSERT (module_code, title, group_name, href, description, sort_n, active, created_at) VALUES ('bip', 'Oracle BIP Reporting', 'Oracle Fusion', '../bip/index.html', 'BI Publisher catalog, runs, dashboards', 17, 'Y', SYSDATE);
MERGE INTO wms_app_modules t USING (SELECT 'dataload' AS module_code FROM dual) s ON (t.module_code = s.module_code)
  WHEN NOT MATCHED THEN INSERT (module_code, title, group_name, href, description, sort_n, active, created_at) VALUES ('dataload', 'Data Loading', 'Oracle Fusion', '../dataload/index.html', 'FBDI templates, REST loads', 18, 'Y', SYSDATE);
MERGE INTO wms_app_modules t USING (SELECT 'fusionmodel' AS module_code FROM dual) s ON (t.module_code = s.module_code)
  WHEN NOT MATCHED THEN INSERT (module_code, title, group_name, href, description, sort_n, active, created_at) VALUES ('fusionmodel', 'Fusion Model', 'Oracle Fusion', '../fusionmodel/index.html', 'DuckDB dataset, dashboards', 19, 'Y', SYSDATE);
MERGE INTO wms_app_modules t USING (SELECT 'powerbi' AS module_code FROM dual) s ON (t.module_code = s.module_code)
  WHEN NOT MATCHED THEN INSERT (module_code, title, group_name, href, description, sort_n, active, created_at) VALUES ('powerbi', 'Power BI', 'Oracle Fusion', '../powerbi/index.html', 'Power BI reports in the app', 20, 'Y', SYSDATE);
MERGE INTO wms_app_modules t USING (SELECT 'aiagent' AS module_code FROM dual) s ON (t.module_code = s.module_code)
  WHEN NOT MATCHED THEN INSERT (module_code, title, group_name, href, description, sort_n, active, created_at) VALUES ('aiagent', 'AI Agent', 'AI', '../aiagent/index.html', 'AI specialists', 21, 'Y', SYSDATE);
MERGE INTO wms_app_modules t USING (SELECT 'aihub' AS module_code FROM dual) s ON (t.module_code = s.module_code)
  WHEN NOT MATCHED THEN INSERT (module_code, title, group_name, href, description, sort_n, active, created_at) VALUES ('aihub', 'AI Hub', 'AI', '../aihub/index.html', 'Model gateway, evals', 22, 'Y', SYSDATE);
MERGE INTO wms_app_modules t USING (SELECT 'aianalysis' AS module_code FROM dual) s ON (t.module_code = s.module_code)
  WHEN NOT MATCHED THEN INSERT (module_code, title, group_name, href, description, sort_n, active, created_at) VALUES ('aianalysis', 'AI Digital Employee', 'AI', '../aianalysis/index.html', 'Ask and operate the WMS in plain English', 23, 'Y', SYSDATE);
MERGE INTO wms_app_modules t USING (SELECT 'teachme' AS module_code FROM dual) s ON (t.module_code = s.module_code)
  WHEN NOT MATCHED THEN INSERT (module_code, title, group_name, href, description, sort_n, active, created_at) VALUES ('teachme', 'Teach Me', 'AI', '../teachme/index.html', 'Lessons the app repeats', 24, 'Y', SYSDATE);
MERGE INTO wms_app_modules t USING (SELECT 'rag' AS module_code FROM dual) s ON (t.module_code = s.module_code)
  WHEN NOT MATCHED THEN INSERT (module_code, title, group_name, href, description, sort_n, active, created_at) VALUES ('rag', 'AI Knowledge Base', 'AI', '../rag/index.html', 'RAG over WMS data', 25, 'Y', SYSDATE);
MERGE INTO wms_app_modules t USING (SELECT 'agentflow' AS module_code FROM dual) s ON (t.module_code = s.module_code)
  WHEN NOT MATCHED THEN INSERT (module_code, title, group_name, href, description, sort_n, active, created_at) VALUES ('agentflow', 'Agent Flow', 'AI', '../agentflow/index.html', 'Agentic flows on a canvas', 26, 'Y', SYSDATE);
MERGE INTO wms_app_modules t USING (SELECT 'internetsearch' AS module_code FROM dual) s ON (t.module_code = s.module_code)
  WHEN NOT MATCHED THEN INSERT (module_code, title, group_name, href, description, sort_n, active, created_at) VALUES ('internetsearch', 'Internet Search', 'AI', '../internetsearch/index.html', 'Web search page', 27, 'Y', SYSDATE);
MERGE INTO wms_app_modules t USING (SELECT 'dllexplorer' AS module_code FROM dual) s ON (t.module_code = s.module_code)
  WHEN NOT MATCHED THEN INSERT (module_code, title, group_name, href, description, sort_n, active, created_at) VALUES ('dllexplorer', 'DLL Explorer', 'Tools', '../dllexplorer/index.html', 'Read a .dll / .exe', 28, 'Y', SYSDATE);
MERGE INTO wms_app_modules t USING (SELECT 'formsdesigner' AS module_code FROM dual) s ON (t.module_code = s.module_code)
  WHEN NOT MATCHED THEN INSERT (module_code, title, group_name, href, description, sort_n, active, created_at) VALUES ('formsdesigner', 'Forms Designer', 'Tools', '../formsdesigner/index.html', 'Master-detail forms', 29, 'Y', SYSDATE);
MERGE INTO wms_app_modules t USING (SELECT 'admin' AS module_code FROM dual) s ON (t.module_code = s.module_code)
  WHEN NOT MATCHED THEN INSERT (module_code, title, group_name, href, description, sort_n, active, created_at) VALUES ('admin', 'Admin', 'Tools', '../admin/index.html', 'Create ZIP file, user access', 30, 'Y', SYSDATE);

-- JAVEED: every module (+ the audit rows)
INSERT INTO wms_user_module_access (app_user, module_code, active, granted_by, granted_at, note, changed_by, changed_date)
  SELECT 'JAVEED', m.module_code, 'Y', 'SYSTEM', SYSDATE, 'Every module (administrator)', 'SYSTEM', SYSDATE FROM wms_app_modules m
   WHERE NOT EXISTS (SELECT 1 FROM wms_user_module_access a WHERE a.app_user = 'JAVEED' AND a.module_code = m.module_code);
INSERT INTO wms_user_access_log (log_id, app_user, module_code, action, by_user, note, logged_at)
  SELECT 'SQL' || m.sort_n || '_' || TO_CHAR(SYSDATE, 'YYYYMMDDHH24MISS'), 'JAVEED', m.module_code, 'GRANT', 'SYSTEM', 'Every module (administrator) — apex_sql/101', SYSDATE FROM wms_app_modules m;
COMMIT;
